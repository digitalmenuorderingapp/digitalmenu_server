const LedgerTransaction = require('../models/LedgerTransaction');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');

// Normalize to IST 00:00 (18:30 UTC previous day)
exports.normalizeToISTMidnight = (date) => {
  const d = new Date(date);
  const istStr = d.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata' });
  const [m, d1, y] = istStr.split('/');
  return new Date(`${y}-${m.padStart(2, '0')}-${d1.padStart(2, '0')}T00:00:00+05:30`);
};

/**
 * Record a financial movement in the ledger
 */
exports.recordTransaction = async ({ order, type, amount, mode, status = 'PENDING' }) => {
  try {
    const transactionDate = exports.normalizeToISTMidnight(order.createdAt);
    
    // Calculate Monthly Running Balance (Resets on 1st of every month)
    const startOfMonth = new Date(transactionDate.getFullYear(), transactionDate.getMonth(), 1);
    const lastTx = await LedgerTransaction.findOne({ 
      restaurant: order.restaurant, 
      transactionDate: { $gte: startOfMonth } 
    }).sort({ transactionDate: -1, _id: -1 });

    const currentMonthlyBalance = lastTx ? (lastTx.monthlyNetBalance || 0) : 0;
    const newMonthlyBalance = currentMonthlyBalance + amount;

    // Also keep overall net balance for historical tracking if needed
    const lastOverallTx = await LedgerTransaction.findOne({ restaurant: order.restaurant }).sort({ transactionDate: -1, _id: -1 });
    const currentOverallBalance = lastOverallTx ? (lastOverallTx.netBalance || 0) : 0;
    const newOverallBalance = currentOverallBalance + amount;

    const transaction = await LedgerTransaction.create({
      restaurant: order.restaurant,
      orderId: order._id,
      type,
      paymentMode: mode.toUpperCase(),
      status,
      amount,
      netBalance: newOverallBalance,
      monthlyNetBalance: newMonthlyBalance,
      transactionDate,
      meta: {
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        deviceId: order.deviceId,
        utr: order.utrNumber
      }
    });

    // Strategy: Immediately trigger a summary sync for this day
    await exports.syncDailyLedger(order.restaurant, order.createdAt);
    
    return transaction;
  } catch (error) {
    console.error('[LedgerService] recordTransaction failed:', error);
    throw error;
  }
};

/**
 * Sync (Rebuild) the DailyLedger summary from LedgerTransactions and Orders
 */
exports.syncDailyLedger = async (restaurantId, date) => {
  try {
    const targetDate = exports.normalizeToISTMidnight(date);
    const startOfDay = targetDate;
    const endOfDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000 - 1);

    // 1. Independent count of all order states
    const allOrders = await Order.find({
      restaurant: restaurantId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    // 2. Fetch all successful orders for analytics (Items & Hours)
    const orders = await Order.find({
      restaurant: restaurantId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['rejected', 'cancelled'] }
    });


    // 3. Self-healing: Ensure all orders have a PAYMENT transaction for this date
    // This handles orders that might have been created without a transaction record
    for (const o of allOrders) {
      const hasTx = await LedgerTransaction.exists({ orderId: o._id, type: 'PAYMENT' });
      if (!hasTx) {
          console.log(`[LedgerService] Healing missing transaction for order: ${o._id}`);
          await exports.recordTransaction({
              order: o,
              type: 'PAYMENT',
              amount: o.totalAmount,
              mode: o.paymentMethod,
              status: o.paymentStatus || 'PENDING'
          });
      }
    }

    // 4. Re-fetch transactions after healing
    const transactions = await LedgerTransaction.find({
      restaurant: restaurantId,
      transactionDate: targetDate
    });

    // Create a fresh DailyLedger summary
    const ledger = await DailyLedger.getOrCreateLedger(targetDate, restaurantId);
    
    // RESET FINANCIALS
    ledger.cash = { received: 0, verified: 0, pending: 0, refunded: 0, balance: 0 };
    ledger.online = { received: 0, verified: 0, pending: 0, refunded: 0, balance: 0 };
    ledger.total = { received: 0, refunded: 0, netBalance: 0 };
    ledger.counts = { totalOrders: 0, servedOrders: 0, rejectedOrders: 0, cancelledOrders: 0 };
    ledger.soldItems = [];
    
    // Reset hourly stats
    ledger.hourlyBreakdown.forEach(h => {
      h.orders = 0; h.revenue = 0; h.servedOrders = 0;
    });

    // PROCESS TRANSACTIONS (Financial Truth)
    transactions.forEach(tx => {
      const mode = tx.paymentMode === 'CASH' ? 'cash' : 'online';
      
      if (tx.type === 'PAYMENT') {
        ledger[mode].received += tx.amount;
        if (tx.status === 'VERIFIED') ledger[mode].verified += tx.amount;
        else ledger[mode].pending += tx.amount;
      } else {
        ledger[mode].refunded += Math.abs(tx.amount);
      }
    });

    // FINALIZING BALANCES
    ledger.cash.balance = ledger.cash.verified - ledger.cash.refunded; // Profit is only from verified cash
    ledger.online.balance = ledger.online.verified - ledger.online.refunded;
    ledger.total.received = ledger.cash.verified + ledger.online.verified; // Net received = verified only
    ledger.total.refunded = ledger.cash.refunded + ledger.online.refunded;
    ledger.total.netBalance = ledger.total.received - ledger.total.refunded;

    // PROCESS COUNTS (Operational Truth)
    allOrders.forEach(o => {
      ledger.counts.totalOrders++;
      if (o.status === 'served') ledger.counts.servedOrders++;
      else if (o.status === 'rejected') ledger.counts.rejectedOrders++;
      else if (o.status === 'cancelled') ledger.counts.cancelledOrders++;
    });

    // PROCESS ANALYTICS (Analytics Truth)
    orders.forEach(o => {
      const orderHour = new Date(o.createdAt).getHours();
      const hourly = ledger.hourlyBreakdown.find(h => h.hour === orderHour);
      if (hourly) {
        hourly.orders++;
        hourly.revenue += o.totalAmount;
        if (o.status === 'served') hourly.servedOrders++;
      }

      o.items.forEach(item => {
        const existing = ledger.soldItems.find(si => si.menuItemId.toString() === item.itemId.toString());
        if (existing) {
          existing.count += item.quantity;
          existing.totalRevenue += (item.price * item.quantity);
        } else {
          ledger.soldItems.push({
            menuItemId: item.itemId,
            name: item.name,
            count: item.quantity,
            totalRevenue: item.price * item.quantity
          });
        }
      });
    });

    ledger.soldItems.sort((a, b) => b.count - a.count);
    await ledger.save();

    return ledger;
  } catch (error) {
    console.error('[LedgerService] syncDailyLedger failed:', error);
    throw error;
  }
};

/**
 * Utility: Delete all transactions for an order and re-record
 * (Useful for status changes or corrections)
 */
exports.revertOrderTransactions = async (orderId, restaurantId) => {
  await LedgerTransaction.deleteMany({ orderId, restaurant: restaurantId });
};

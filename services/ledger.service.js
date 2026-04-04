const LedgerTransaction = require('../models/LedgerTransaction');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');

// Normalize to IST 00:00 (18:30 UTC previous day)
exports.normalizeToISTMidnight = (date) => {
  const d = new Date(date);
  
  // Create a formatter for IST date components
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });

  const parts = formatter.formatToParts(d);
  const getPart = (type) => parts.find(p => p.type === type).value;
  
  const y = getPart('year');
  const m = getPart('month');
  const d1 = getPart('day');
  
  // Return at 00:00:00 IST
  return new Date(`${y}-${m}-${d1}T00:00:00+05:30`);
};

/**
 * Record a financial movement in the ledger
 */
exports.recordTransaction = async ({ order, type, amount, mode, status = 'PENDING' }) => {
  try {
    // HARDENING: Only allow 'VERIFIED' or 'PENDING' in LedgerTransaction.
    // If we get 'UNPAID', 'RETRY', or anything else, fallback to 'PENDING'.
    const normalizedStatus = status === 'VERIFIED' ? 'VERIFIED' : 'PENDING';
    
    const transactionDate = exports.normalizeToISTMidnight(order.createdAt);

    // IDEMPOTENCY GUARD: Prevent duplicate REFUND transactions for the same order.
    // A refund should only ever be recorded once per order.
    if (type === 'REFUND') {
      const existingRefund = await LedgerTransaction.findOne({ orderId: order._id, type: 'REFUND' });
      if (existingRefund) {
        console.warn(`[LedgerService] Duplicate REFUND blocked for order: ${order._id}. Existing TX: ${existingRefund._id}`);
        return existingRefund;
      }
    }
    
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
      status: normalizedStatus,
      amount,
      netBalance: newOverallBalance,
      monthlyNetBalance: newMonthlyBalance,
      transactionDate,
      meta: {
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        deviceId: order.deviceId,
        utr: order.utr
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

    // Ensure restaurantId is an ObjectId if it happens to be a string
    const mongoose = require('mongoose');
    const rId = typeof restaurantId === 'string' ? new mongoose.Types.ObjectId(restaurantId) : restaurantId;

    // 1. Independent count of all order states
    const allOrders = await Order.find({
      restaurant: rId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    // 2. Fetch all successful orders for analytics (Items & Hours)
    const orders = await Order.find({
      restaurant: rId,
      createdAt: { $gte: startOfDay, $lte: endOfDay },
      status: { $nin: ['REJECTED', 'CANCELLED'] }
    });
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LedgerSync] ${targetDate.toISOString()} - Found ${allOrders.length} total orders, ${orders.length} active orders.`);
    }


    // 3. Self-healing: Ensure all orders have a PAYMENT transaction for this date
    // This handles orders that might have been created without a transaction record
    for (const o of allOrders) {
      const hasTx = await LedgerTransaction.exists({ orderId: o._id, type: 'PAYMENT' });
      if (!hasTx) {
          console.log(`[LedgerService] Healing missing transaction for order: ${o._id}`);
          let mode = o.paymentMethod || 'COUNTER';
          if (mode === 'CASH') mode = 'COUNTER';

          await exports.recordTransaction({
              order: o,
              type: 'PAYMENT',
              amount: o.totalAmount,
              mode: mode,
              status: o.paymentStatus // Now safely normalized by recordTransaction
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
    ledger.counter = { received: 0, verified: 0, pending: 0, refunded: 0, balance: 0 };
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
      const mode = (tx.paymentMode === 'CASH' || tx.paymentMode === 'COUNTER') ? 'counter' : 'online';
      
      if (tx.type === 'PAYMENT') {
        ledger[mode].received += tx.amount;
        if (tx.status === 'VERIFIED') ledger[mode].verified += tx.amount;
        else ledger[mode].pending += tx.amount;
      } else {
        ledger[mode].refunded += Math.abs(tx.amount);
      }
    });
    
    // FINALIZING BALANCES
    ledger.counter.balance = ledger.counter.verified - ledger.counter.refunded; 
    ledger.online.balance = ledger.online.verified - ledger.online.refunded;
    ledger.total.received = ledger.counter.verified + ledger.online.verified; 
    ledger.total.refunded = ledger.counter.refunded + ledger.online.refunded;
    ledger.total.netBalance = ledger.total.received - ledger.total.refunded;

    // PROCESS COUNTS (Operational Truth)
    allOrders.forEach(o => {
      ledger.counts.totalOrders++;
      if (o.status === 'COMPLETED') ledger.counts.servedOrders++;
      else if (o.status === 'REJECTED') ledger.counts.rejectedOrders++;
      else if (o.status === 'CANCELLED') ledger.counts.cancelledOrders++;
    });

    // PROCESS ANALYTICS (Analytics Truth)
    orders.forEach(o => {
      const orderHour = new Date(o.createdAt).getHours();
      const hourly = ledger.hourlyBreakdown.find(h => h.hour === orderHour);
      if (hourly) {
        hourly.orders++;
        hourly.revenue += o.totalAmount;
        if (o.status === 'COMPLETED') hourly.servedOrders++;
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

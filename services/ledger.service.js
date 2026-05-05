const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const mongoose = require('mongoose');

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
 * (Now just a wrapper to trigger sync, as Order is the source of truth)
 */
exports.recordTransaction = async ({ order, createdAt }) => {
  try {
    // Trigger immediate daily sync
    await exports.syncDailyLedger(order.restaurant, createdAt || order.createdAt);
  } catch (error) {
    console.error('[LedgerService] recordTransaction proxy failed:', error);
    // Non-blocking for the main order flow
  }
};

/**
 * Sync (Rebuild) the DailyLedger summary from Orders
 */
exports.syncDailyLedger = async (restaurantId, date) => {
  try {
    const targetDate = exports.normalizeToISTMidnight(date);
    const startOfDay = targetDate;
    const endOfDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000 - 1);

    const rId = typeof restaurantId === 'string' ? new mongoose.Types.ObjectId(restaurantId) : restaurantId;

    // 1. Fetch all orders for this restaurant and date
    const allOrders = await Order.find({
      restaurant: rId,
      createdAt: { $gte: startOfDay, $lte: endOfDay }
    });

    // 2. Fetch all successful orders for analytics (Items & Hours)
    const activeOrders = allOrders.filter(o => !['REJECTED', 'CANCELLED'].includes(o.status));
    
    if (process.env.NODE_ENV === 'development') {
      console.log(`[LedgerSync] ${targetDate.toISOString()} - Found ${allOrders.length} total orders, ${activeOrders.length} active orders.`);
    }

    // 3. Create/Get DailyLedger summary
    const ledger = await DailyLedger.getOrCreateLedger(targetDate, restaurantId);

    // RESET all totals to 0 before accumulation
    ledger.cashReceivedAmount = 0;
    ledger.onlineReceivedAmount = 0;
    ledger.pendingAmount = 0;
    ledger.total = { netBalance: 0, unpaidDues: 0, totalRevenue: 0 };

    ledger.counts = { 
      totalOrders: 0, 
      servedOrders: 0, 
      rejectedOrders: 0, 
      cancelledOrders: 0,
      orderType: { dineIn: 0, takeaway: 0, delivery: 0 },
      pendingPayments: 0,
      dueOrders: 0
    };
    ledger.soldItems = [];
    ledger.hourlyBreakdown.forEach(h => {
      h.orders = 0;
      h.revenue = 0;
      h.servedOrders = 0;
    });
    
    // 4. Calculate Stats from Orders
    let earnedRevenue = 0;
    let unpaidDues = 0;
    let totalPending = 0;
    let cashVerified = 0;
    let onlineVerified = 0;

    allOrders.forEach(o => {
      ledger.counts.totalOrders++;
      
      const isRejected = ['REJECTED', 'CANCELLED'].includes(o.status);
      const isVerified = o.paymentStatus === 'VERIFIED';
      const isServed = o.status === 'COMPLETED';
      const isDue = o.paymentStatus === 'UNPAID';
      const isPending = o.paymentStatus === 'PENDING';
      const amt = o.totalAmount || 0;

      // Operational Counts
      if (o.status === 'COMPLETED') ledger.counts.servedOrders++;
      else if (o.status === 'REJECTED') ledger.counts.rejectedOrders++;
      else if (o.status === 'CANCELLED') ledger.counts.cancelledOrders++;

      if (!isRejected) {
        // Order Type
        if (o.orderType === 'dine-in') ledger.counts.orderType.dineIn++;
        else if (o.orderType === 'takeaway') ledger.counts.orderType.takeaway++;
        else if (o.orderType === 'delivery') ledger.counts.orderType.delivery++;
        
        // Payment Counts
        if (!isVerified) ledger.counts.pendingPayments++;
        if (isDue) ledger.counts.dueOrders++;

        // Financials
        if (isVerified) {
          if (o.collectedVia === 'CASH') cashVerified += amt;
          else if (o.collectedVia === 'ONLINE') onlineVerified += amt;
          else if (o.collectedVia === 'SPLIT') {
            cashVerified += (o.splitPayment?.cashAmount || 0);
            onlineVerified += (o.splitPayment?.onlineAmount || 0);
          }
        }

        if (isServed) earnedRevenue += amt;
        if (isDue) unpaidDues += amt;
        if (isPending) totalPending += amt;
      }
    });

    ledger.cashReceivedAmount = cashVerified;
    ledger.onlineReceivedAmount = onlineVerified;
    ledger.pendingAmount = totalPending;
    ledger.total.netBalance = cashVerified + onlineVerified;
    ledger.total.unpaidDues = unpaidDues;
    ledger.total.totalRevenue = earnedRevenue;

    // 5. Process Analytics Breakdown
    activeOrders.forEach(o => {
      const orderHour = new Date(o.createdAt).getHours();
      const hourly = ledger.hourlyBreakdown.find(h => h.hour === orderHour);
      if (hourly) {
        hourly.orders++;
        hourly.revenue += (o.totalAmount || 0);
        if (o.status === 'COMPLETED') hourly.servedOrders++;
      }

      (o.items || []).forEach(item => {
        const existing = ledger.soldItems.find(si => si.menuItemId?.toString() === item.itemId?.toString());
        if (existing) {
          existing.count += (item.quantity || 0);
          existing.totalRevenue += ((item.price || 0) * (item.quantity || 0));
        } else {
          ledger.soldItems.push({
            menuItemId: item.itemId,
            name: item.name,
            count: item.quantity,
            totalRevenue: (item.price || 0) * (item.quantity || 0)
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
 * Proxy for reverting orders
 */
exports.revertOrderTransactions = async (orderId, restaurantId) => {
  // No-op now as we don't store separate transactions
  return true;
};

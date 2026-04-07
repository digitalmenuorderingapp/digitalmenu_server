const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const ledgerService = require('../services/ledger.service');
const excelHelper = require('../helpers/excel.helper');
const emailService = require('../services/email.service');
const { reportEmailTemplate } = require('../templates/reportEmail');
const RestaurantAdmin = require('../models/RestaurantAdmin');

/**
 * Helper to transform DailyLedger document to match frontend expectation (nested structure)
 */
const transformLedgerForFrontend = (ledger) => {
  if (!ledger) return null;
  const l = ledger.toObject ? ledger.toObject() : ledger;
  
  // Total pending is shared in simplified model
  const totalPending = l.pendingAmount || 0;

  // Create nested structure exactly as frontend expects
  return {
    ...l,
    cash: {
      received: l.cashReceivedAmount || 0,
      verified: l.cashReceivedAmount || 0,
      pending: totalPending, // Simplified model uses single pending field
      balance: l.cashReceivedAmount || 0
    },
    online: {
      received: l.onlineReceivedAmount || 0,
      verified: l.onlineReceivedAmount || 0,
      pending: 0, 
      balance: l.onlineReceivedAmount || 0
    },
    total: {
      ...l.total,
      received: (l.cashReceivedAmount || 0) + (l.onlineReceivedAmount || 0)
    }
  };
};

// Get daily ledger summary
exports.getDailyLedger = async (req, res, next) => {
  try {
    const { date } = req.query;
    const restaurantId = req.userId;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required' });
    }

    const ledger = await DailyLedger.getOrCreateLedger(date, restaurantId);
    
    res.json({
      success: true,
      data: transformLedgerForFrontend(ledger)
    });
  } catch (error) {
    next(error);
  }
};

// Get today's ledger (shortcut)
exports.getTodayLedger = async (req, res, next) => {
  try {
    const ledger = await DailyLedger.getOrCreateLedger(new Date(), req.userId);
    
    res.json({
      success: true,
      data: transformLedgerForFrontend(ledger)
    });
  } catch (error) {
    next(error);
  }
};

// Get transactions for a date
exports.getTransactions = async (req, res, next) => {
  try {
    const { date, startDate, endDate, page = 1, limit = 100 } = req.query;
    const restaurantId = req.userId;

    let query = { restaurant: restaurantId };

    if (startDate && endDate) {
        const start = ledgerService.normalizeToISTMidnight(startDate);
        const end = ledgerService.normalizeToISTMidnight(endDate);
        query.createdAt = { $gte: start, $lte: end };
    } else if (date) {
        const start = ledgerService.normalizeToISTMidnight(date);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
        query.createdAt = { $gte: start, $lte: end };
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [orders, totalCount] = await Promise.all([
      Order.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean({ virtuals: true }),
      Order.countDocuments(query)
    ]);

    // Map Order docs to LedgerTransaction structure for frontend compatibility
    const transactions = orders.map(order => ({
      _id: order._id,
      restaurant: order.restaurant,
      orderId: order._id,
      type: 'PAYMENT',
      paymentMode: order.collectedVia || 'CASH',
      status: order.paymentStatus || 'PENDING',
      amount: order.totalAmount,
      transactionDate: order.createdAt, // Frontend expected field
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      meta: {
        orderNumber: order.orderNumber,
        tableNumber: order.tableNumber,
        deviceId: order.deviceId,
        utr: order.utr || ''
      }
    }));

    res.json({
      success: true,
      count: transactions.length,
      total: totalCount,
      page: parseInt(page),
      pages: Math.ceil(totalCount / parseInt(limit)),
      data: { orders: transactions }
    });
  } catch (error) {
    next(error);
  }
};

// Get monthly ledger summary
exports.getMonthlyLedger = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const restaurantId = req.userId;
    
    let start, end;
    if (month && year) {
        start = new Date(parseInt(year), parseInt(month) - 1, 1);
        end = new Date(parseInt(year), parseInt(month), 0);
    } else {
        const now = new Date();
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    }

    const istStart = ledgerService.normalizeToISTMidnight(start);
    const istEnd = ledgerService.normalizeToISTMidnight(end);

    const ledgers = await DailyLedger.find({
      restaurant: restaurantId,
      date: { $gte: istStart, $lte: istEnd }
    })
    .sort({ date: -1 })
    .lean();

    res.json({
      success: true,
      data: { ledgers: ledgers.map(l => transformLedgerForFrontend(l)) }
    });
  } catch (error) {
    next(error);
  }
};

// Re-sync (Recalculate) daily ledger
exports.recalculateLedger = async (req, res, next) => {
  try {
    const { date = new Date() } = req.body;
    const restaurantId = req.userId;

    const ledger = await ledgerService.syncDailyLedger(restaurantId, date);

    res.json({
      success: true,
      message: 'Ledger recalculated successfully',
      data: transformLedgerForFrontend(ledger)
    });
  } catch (error) {
    next(error);
  }
};

// Export detailed monthly report
exports.exportReportToMail = async (req, res, next) => {
  try {
    const userId = req.userId;
    const user = await RestaurantAdmin.findById(userId).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    res.json({
      success: true,
      message: `Detailed report is being prepared and will be sent to ${user.email} shortly.`
    });

    (async () => {
      try {
        const moment = require('moment-timezone');
        const { sendDetailedReportEmail } = require('../utils/reportHelper');
        
        const now = moment().tz('Asia/Kolkata');
        const dateRange = {
          from: now.clone().startOf('month').format('YYYY-MM-DD'),
          to: now.format('YYYY-MM-DD'),
          fromDate: now.clone().startOf('month').toDate(),
          toDate: now.toDate()
        };

        await sendDetailedReportEmail({
          restaurant: user,
          emailType: 'MONTHLY',
          dateRange,
          subject: `${user.restaurantName} - Detailed Monthly Report - ${now.format('MMMM YYYY')}`
        });

      } catch (bgError) {
        console.error('[ManualExport] Background export failed:', bgError);
      }
    })();

  } catch (error) {
    next(error);
  }
};

const DailyLedger = require('../models/DailyLedger');
const LedgerTransaction = require('../models/LedgerTransaction');
const ledgerService = require('../services/ledger.service');
const excelHelper = require('../helpers/excel.helper');
const emailService = require('../services/email.service');
const { reportEmailTemplate } = require('../templates/reportEmail');
const RestaurantAdmin = require('../models/RestaurantAdmin');

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
      data: ledger
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
      data: ledger
    });
  } catch (error) {
    next(error);
  }
};

// Get transactions for a date (with pagination)
exports.getTransactions = async (req, res, next) => {
  try {
    const { date, startDate, endDate, page = 1, limit = 100 } = req.query;
    const restaurantId = req.userId;

    let query = { restaurant: restaurantId };

    if (startDate && endDate) {
        const start = ledgerService.normalizeToISTMidnight(startDate);
        const end = ledgerService.normalizeToISTMidnight(endDate);
        query.transactionDate = { $gte: start, $lte: end };
    } else if (date) {
        query.transactionDate = ledgerService.normalizeToISTMidnight(date);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [transactions, totalCount] = await Promise.all([
      LedgerTransaction.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      LedgerTransaction.countDocuments(query)
    ]);

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
      data: { ledgers }
    });
  } catch (error) {
    next(error);
  }
};

// Re-sync (Recalculate) daily ledger from scratch
exports.recalculateLedger = async (req, res, next) => {
  try {
    const { date = new Date() } = req.body;
    const restaurantId = req.userId;

    const ledger = await ledgerService.syncDailyLedger(restaurantId, date);

    res.json({
      success: true,
      message: 'Ledger recalculated successfully',
      data: ledger
    });
  } catch (error) {
    next(error);
  }
};

// Export detailed monthly report to mail (Manual Trigger)
exports.exportReportToMail = async (req, res, next) => {
  try {
    const userId = req.userId;
    const user = await RestaurantAdmin.findById(userId).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    // Return response immediately, process email in background
    res.json({
      success: true,
      message: `Detailed report is being prepared and will be sent to ${user.email} shortly.`
    });

    // Process in background
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

        console.log(`[ManualExport] Detailed report sent to ${user.email}`);
      } catch (bgError) {
        console.error('[ManualExport] Background export failed:', bgError);
      }
    })();

  } catch (error) {
    next(error);
  }
};

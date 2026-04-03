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
    const { date } = req.body;
    const restaurantId = req.userId;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required' });
    }

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

// Send Monthly Ledger Report via Email (Detailed Transactions) - Non-blocking
exports.sendReportEmail = async (req, res, next) => {
  try {
    const restaurantId = req.userId;
    const user = await RestaurantAdmin.findById(restaurantId).lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    // Return response immediately, process email in background
    res.json({
      success: true,
      message: `Report is being prepared and will be sent to ${user.email} shortly`
    });

    // Process email asynchronously (fire-and-forget)
    (async () => {
      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const endOfRange = now;

        // Fetch transactions with pagination for large datasets
        const transactions = await LedgerTransaction.find({
          restaurant: restaurantId,
          transactionDate: { $gte: startOfMonth, $lte: endOfRange }
        })
        .sort({ transactionDate: 1 })
        .lean();

        // Prepare Excel Data
        const columns = [
          { header: 'Date' },
          { header: 'Time' },
          { header: 'Order No' },
          { header: 'Table' },
          { header: 'Type' },
          { header: 'Mode' },
          { header: 'Status' },
          { header: 'Amount (Tax Incl)' },
          { header: 'Monthly Net Balance' }
        ];

        const rows = transactions.map(t => {
          const dateObj = new Date(t.transactionDate);
          return [
            dateObj.toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }),
            dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true }),
            t.meta?.orderNumber || 'N/A',
            t.meta?.tableNumber || '-',
            t.type,
            t.paymentMode,
            t.status,
            `₹${Math.abs(t.amount).toFixed(2)}`,
            `₹${(t.monthlyNetBalance || 0).toFixed(2)}`
          ];
        });

        const periodStr = `${startOfMonth.toLocaleDateString('en-IN')} - ${endOfRange.toLocaleDateString('en-IN')}`;

        const excelBuffer = await excelHelper.createStyledWorkbook({
          sheetName: 'Transaction Journal',
          reportTitle: 'Monthly Audit Journal',
          restaurantName: user.restaurantName || 'Your Restaurant',
          period: periodStr,
          columns,
          rows
        });

        // Calculate Summary Stats
        const verifiedPayments = transactions
          .filter(t => t.type === 'PAYMENT' && t.status === 'VERIFIED')
          .reduce((sum, t) => sum + t.amount, 0);

        const pendingPayments = transactions
          .filter(t => t.type === 'PAYMENT' && t.status === 'PENDING')
          .reduce((sum, t) => sum + t.amount, 0);

        const totalRefunds = transactions
          .filter(t => t.type === 'REFUND')
          .reduce((sum, t) => sum + Math.abs(t.amount), 0);

        const netBalance = verifiedPayments - totalRefunds;

        const summary = {
          'Net Balance (Verified)': `₹${netBalance.toFixed(2)}`,
          'Total Verified Income': `₹${verifiedPayments.toFixed(2)}`,
          'Total Processed Refunds': `₹${totalRefunds.toFixed(2)}`,
          'Total Pending Collection': `₹${pendingPayments.toFixed(2)}`,
          'Total Transactions': transactions.length
        };

        const html = reportEmailTemplate({
          restaurantName: user.restaurantName || 'Partner',
          reportType: 'Detailed Financial Ledger',
          period: periodStr,
          summary
        });

        await emailService.sendEmailWithAttachments(
          user.email,
          `Monthly Audit Journal - ${user.restaurantName}`,
          `Your Monthly Audit Journal for ${periodStr} is attached.`,
          [{
            filename: `Audit_Journal_${now.getFullYear()}_${now.getMonth() + 1}.xlsx`,
            content: excelBuffer
          }],
          html
        );

        console.log(`[Ledger] Report email sent successfully to ${user.email}`);
      } catch (error) {
        console.error('[Ledger] Failed to send report email:', error);
      }
    })();

  } catch (error) {
    next(error);
  }
};

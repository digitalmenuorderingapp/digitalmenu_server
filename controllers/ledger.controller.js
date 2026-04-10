const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const ledgerService = require('../services/ledger.service');
const excelHelper = require('../helpers/excel.helper');
const emailService = require('../services/email.service');
const { reportEmailTemplate } = require('../templates/reportEmail');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const { searchReports, getFileFromCloudinary, uploadRawToCloudinary } = require('../utils/cloudinary');
const ReportService = require('../services/report.service');
const moment = require('moment-timezone');

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

// Get available reports from Cloudinary
exports.getAvailableReports = async (req, res, next) => {
  try {
    const userId = req.userId;
    const restaurant = await RestaurantAdmin.findById(userId).lean();
    
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    const shortId = restaurant.shortId || restaurant._id.toString();
    const folder = `digitalmenu/reports/${shortId}`;
    
    // Search for reports in Cloudinary
    const resources = await searchReports(folder);
    
    // Format response as month-key -> url mapping
    const reports = {};
    resources.forEach(resource => {
      // Extract month and year from filename
      const filename = resource.public_id.split('/').pop();
      const match = filename.match(/report-(\d{4})-(\d{2})/);
      if (match) {
        const [, year, month] = match;
        reports[`${year}-${month}`] = resource.secure_url;
      }
    });

    res.json({
      success: true,
      reports
    });
  } catch (error) {
    console.error('[AvailableReports] Error:', error);
    res.json({
      success: true,
      reports: {}
    });
  }
};

// Download report from Cloudinary
exports.downloadReportFromCloudinary = async (req, res, next) => {
  try {
    const { month, year } = req.query;
    const userId = req.userId;
    
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year are required' });
    }

    const restaurant = await RestaurantAdmin.findById(userId).lean();
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    const shortId = restaurant.shortId || restaurant._id.toString();
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const publicId = `digitalmenu/reports/${shortId}/report-${monthKey}`;

    try {
      // Try to get file from Cloudinary
      const buffer = await getFileFromCloudinary(publicId);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="ledger-report-${monthKey}.xlsx"`);
      res.send(buffer);
    } catch (cloudinaryError) {
      console.error('[DownloadReport] Cloudinary fetch failed:', cloudinaryError);
      return res.status(404).json({ 
        success: false, 
        message: 'Report not found in cloud storage. Please generate for current month only.' 
      });
    }
  } catch (error) {
    next(error);
  }
};

// Generate report and return directly (for current month)
exports.generateAndDownloadReport = async (req, res, next) => {
  try {
    const { month, year } = req.body;
    const userId = req.userId;
    
    if (!month || !year) {
      return res.status(400).json({ success: false, message: 'Month and year are required' });
    }

    const restaurant = await RestaurantAdmin.findById(userId).lean();
    if (!restaurant) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    const now = moment().tz('Asia/Kolkata');
    const currentMonth = now.month() + 1; // 1-indexed
    const currentYear = now.year();

    // Validate it's current month
    if (parseInt(month) !== currentMonth || parseInt(year) !== currentYear) {
      return res.status(400).json({ 
        success: false, 
        message: 'Live generation only available for current month. Previous months are read-only from cloud storage.' 
      });
    }

    // Generate date range for the month
    const startDate = moment().year(year).month(month - 1).startOf('month').toDate();
    const endDate = moment().year(year).month(month - 1).endOf('month').toDate();

    // Fetch orders for the period
    const orders = await Order.find({
      restaurant: userId,
      createdAt: { $gte: startDate, $lte: endDate }
    }).sort({ createdAt: 1 }).lean({ virtuals: true });

    // Generate report buffer
    const reportBuffer = await ReportService.generateReport(
      restaurant,
      orders,
      {
        dateRange: { 
          from: moment(startDate).format('YYYY-MM-DD'), 
          to: moment(endDate).format('YYYY-MM-DD') 
        },
        reportType: 'Monthly',
        includeOnlyVerified: true
      }
    );

    // Also upload to Cloudinary for future downloads
    (async () => {
      try {
        const shortId = restaurant.shortId || restaurant._id.toString();
        const monthKey = `${year}-${String(month).padStart(2, '0')}`;
        const filename = `report-${monthKey}`;
        const folder = `digitalmenu/reports/${shortId}`;
        
        await uploadRawToCloudinary(reportBuffer, filename, folder);
        console.log(`[GenerateReport] Uploaded to Cloudinary: ${folder}/${filename}`);
      } catch (uploadError) {
        console.error('[GenerateReport] Failed to upload to Cloudinary:', uploadError);
        // Don't fail the download if upload fails
      }
    })();

    // Send file to client
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ledger-report-${monthKey}.xlsx"`);
    res.send(reportBuffer);

  } catch (error) {
    next(error);
  }
};

const LedgerTransaction = require('../models/LedgerTransaction');
const Order = require('../models/Order');
const ReportService = require('../services/report.service');
const emailService = require('../services/email.service');
const { detailedReportEmailTemplate, accountDeletionExportTemplate } = require('../templates/detailedReportEmail');
const moment = require('moment-timezone');

/**
 * Unified function to send detailed report email
 * Used by: Manual Trigger, Account Deletion, and Month-End Manager
 * 
 * @param {Object} options 
 * @param {Object} options.restaurant - RestaurantAdmin document
 * @param {String} options.emailType - 'MONTHLY' or 'DELETION'
 * @param {Object} options.dateRange - { from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', fromDate: Date, toDate: Date }
 * @param {String} options.subject - Email subject
 * @param {Object} options.customSummary - Additional stats for Deletion template
 * @param {Array} options.additionalAttachments - Extra files like menu export for deletion
 */
exports.sendDetailedReportEmail = async (options) => {
  const { 
    restaurant, 
    emailType = 'MONTHLY', 
    dateRange, 
    subject, 
    customSummary = {}, 
    additionalAttachments = [],
    menuItems = []
  } = options;

  const userId = restaurant._id;
  const now = moment().tz('Asia/Kolkata');

  // 1. Fetch data for the report
  const transactions = await LedgerTransaction.find({
    restaurant: userId,
    transactionDate: { $gte: dateRange.fromDate, $lte: dateRange.toDate }
  }).sort({ transactionDate: 1 }).lean();

  const orderIds = [...new Set(transactions.map(t => t.orderId?.toString()).filter(Boolean))];
  const orders = await Order.find({ _id: { $in: orderIds } }).lean();

  // 2. Generate Excel Buffer (The "1reportsheet")
  const reportBuffer = await ReportService.generateReport(
    restaurant,
    transactions,
    orders,
    {
      dateRange: { from: dateRange.from, to: dateRange.to },
      reportType: emailType === 'DELETION' ? 'Final Export' : 'Monthly',
      includeOnlyVerified: true,
      menuItems: menuItems
    }
  );

  // 3. Prepare Stats for Email Template (Aligned with new logic)
  const verifiedPayments = transactions
    .filter(t => t.type === 'PAYMENT' && t.status === 'VERIFIED')
    .reduce((sum, t) => sum + (t.amount || 0), 0);

  const totalRefunds = transactions
    .filter(t => t.type === 'REFUND')
    .reduce((sum, t) => sum + Math.abs(t.amount || 0), 0);

  const netBalance = verifiedPayments - totalRefunds;

  // Calculate Earned Revenue (Verified + Served)
  const verifiedOrderIds = new Set(transactions.filter(t => t.type === 'PAYMENT' && t.status === 'VERIFIED').map(t => t.orderId?.toString()));
  const earnedRevenue = orders.reduce((sum, o) => {
    const isVerified = verifiedOrderIds.has(o._id.toString());
    const isServed = o.status === 'COMPLETED';
    const isRejected = o.status === 'REJECTED' || o.status === 'CANCELLED';
    const isUnpaid = o.paymentStatus === 'UNPAID';
    const amt = o.totalAmount || 0;

    if (!isRejected) {
      if (isVerified && isServed) return sum + amt;
      if (isServed && !isVerified && isUnpaid) return sum - amt;
    }
    return sum;
  }, 0);

  // 4. Select and Render HTML Template
  let html = '';
  const timestamp = now.format('YYYY-MM-DD HH:mm:ss');
  
  if (emailType === 'DELETION') {
    html = accountDeletionExportTemplate({
      ownerName: restaurant.ownerName,
      restaurantName: restaurant.restaurantName,
      summary: {
        totalTransactions: transactions.length,
        totalOrders: orders.length,
        totalMenuItems: customSummary.totalMenuItems || 0,
        dateRange: `${dateRange.from} to ${dateRange.to}`
      },
      exportedAt: timestamp
    });
  } else {
    // For Manual and Month-End
    html = detailedReportEmailTemplate({
      ownerName: restaurant.ownerName,
      restaurantName: restaurant.restaurantName,
      month: moment(dateRange.fromDate).tz('Asia/Kolkata').format('MMMM YYYY'),
      dateRange,
      summary: {
        netBalance,
        verifiedPayments,
        totalRefunds,
        earnedRevenue,
        totalCount: transactions.length
      },
      generatedAt: timestamp
    });
  }

  // 5. Consolidate Attachments
  const fileTimestamp = now.format('YYYY-MM-DD_HH-mm');
  const mainReportFilename = emailType === 'DELETION' 
    ? `digitalmenu-full-report-${restaurant.shortId || 'export'}-${fileTimestamp}.xlsx`
    : `detailed-report-${restaurant.shortId || 'export'}-${fileTimestamp}.xlsx`;

  const attachments = [
    { filename: mainReportFilename, content: reportBuffer },
    ...additionalAttachments
  ];

  // 6. Send Email
  await emailService.sendEmailWithAttachments(
    restaurant.email,
    subject || `Detailed Report - ${restaurant.restaurantName}`,
    `Your detailed report from ${dateRange.from} to ${dateRange.to} is attached.`,
    attachments,
    html
  );

  return { transactions, orders, reportBuffer };
};

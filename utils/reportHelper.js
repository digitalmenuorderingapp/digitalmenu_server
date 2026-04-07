const Order = require('../models/Order');
const ReportService = require('../services/report.service');
const emailService = require('../services/email.service');
const { detailedReportEmailTemplate, accountDeletionExportTemplate } = require('../templates/detailedReportEmail');
const moment = require('moment-timezone');

/**
 * Unified function to send detailed report email
 * (Now solely based on Order model)
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

  // 1. Fetch data for the report (Truth is in Orders)
  const orders = await Order.find({
    restaurant: userId,
    createdAt: { $gte: dateRange.fromDate, $lte: dateRange.toDate }
  }).sort({ createdAt: 1 }).lean({ virtuals: true });

  // 2. Generate Excel Buffer
  const reportBuffer = await ReportService.generateReport(
    restaurant,
    orders,
    {
      dateRange: { from: dateRange.from, to: dateRange.to },
      reportType: emailType === 'DELETION' ? 'Final Export' : 'Monthly',
      includeOnlyVerified: true,
      menuItems: menuItems
    }
  );

  // 3. Prepare Stats for Email Template
  const verifiedPayments = orders
    .filter(o => o.paymentStatus === 'VERIFIED')
    .reduce((sum, o) => sum + (o.totalAmount || 0), 0);

  const netBalance = verifiedPayments;

  const earnedRevenue = orders.reduce((sum, o) => {
    const isServed = o.status === 'COMPLETED';
    const isRejected = ['REJECTED', 'CANCELLED'].includes(o.status);
    const amt = o.totalAmount || 0;

    if (!isRejected && isServed) {
      return sum + amt;
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
        totalTransactions: orders.filter(o => o.paymentStatus === 'VERIFIED').length,
        totalOrders: orders.length,
        totalMenuItems: customSummary.totalMenuItems || 0,
        dateRange: `${dateRange.from} to ${dateRange.to}`
      },
      exportedAt: timestamp
    });
  } else {
    html = detailedReportEmailTemplate({
      ownerName: restaurant.ownerName,
      restaurantName: restaurant.restaurantName,
      month: moment(dateRange.fromDate).tz('Asia/Kolkata').format('MMMM YYYY'),
      dateRange,
      summary: {
        netBalance,
        verifiedPayments,
        earnedRevenue,
        totalCount: orders.length
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

  return { orders, reportBuffer };
};

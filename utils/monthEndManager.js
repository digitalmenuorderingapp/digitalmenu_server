const RestaurantAdmin = require('../models/RestaurantAdmin');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const LedgerTransaction = require('../models/LedgerTransaction');
const ReportService = require('../services/report.service');
const emailService = require('../services/email.service');
const moment = require('moment-timezone');

/**
 * Core logic for processing end-of-month reports and data purging.
 * Updated to use new detailed report format with merged Order + LedgerTransaction data.
 */
const processEndOfMonth = async () => {
  try {
    const restaurants = await RestaurantAdmin.find({});
    const now = moment().tz('Asia/Kolkata');
    
    // Calculate last month details
    const lastMonth = now.clone().subtract(1, 'month');
    const monthName = lastMonth.format('MMMM');
    const year = lastMonth.year();

    const monthStart = lastMonth.clone().startOf('month').toDate();
    const monthEnd = lastMonth.clone().endOf('month').toDate();
    const currentMonthStart = now.clone().startOf('month').toDate();

    console.log(`Starting month-end processing for ${monthName} ${year}...`);

    for (const restaurant of restaurants) {
      try {
        // 1. Fetch last month's data (LedgerTransactions and Orders)
        const transactions = await LedgerTransaction.find({
          restaurant: restaurant._id,
          transactionDate: { $gte: monthStart, $lte: monthEnd }
        }).sort({ transactionDate: 1 }).lean();

        if (transactions.length === 0) {
          console.log(`Skipping restaurant ${restaurant.restaurantName}: No data for ${monthName}`);
          continue;
        }

        // Get unique order IDs from transactions
        const orderIds = [...new Set(transactions.map(t => t.orderId?.toString()).filter(Boolean))];

        // Fetch all related orders
        const orders = await Order.find({
          _id: { $in: orderIds }
        }).lean();

        // Aggregate summary from DailyLedger for email template
        const dailyLedgers = await DailyLedger.find({
          restaurant: restaurant._id,
          date: { $gte: monthStart, $lte: monthEnd }
        }).sort({ date: 1 });

        const summary = dailyLedgers.reduce((acc, curr) => {
          acc.totalOrders += curr.counts.totalOrders || 0;
          acc.servedOrders += curr.counts.servedOrders || 0;
          acc.amountReceivedCash += curr.cash.verified || 0;
          acc.amountReceivedOnline += curr.online.verified || 0;
          acc.totalAmountReceived += (curr.cash.verified + curr.online.verified) || 0;
          acc.refundedAmount += curr.total.refunded || 0;
          acc.totalRefunds += (curr.counts.rejectedOrders + curr.counts.cancelledOrders) || 0;
          return acc;
        }, {
          totalOrders: 0,
          servedOrders: 0,
          totalAmountReceived: 0,
          amountReceivedCash: 0,
          amountReceivedOnline: 0,
          refundedAmount: 0,
          totalRefunds: 0
        });

        // 2. Send email using the unified reportHelper
        const { sendDetailedReportEmail } = require('../utils/reportHelper');
        const dateRange = {
          from: moment(monthStart).tz('Asia/Kolkata').format('YYYY-MM-DD'),
          to: moment(monthEnd).tz('Asia/Kolkata').format('YYYY-MM-DD'),
          fromDate: monthStart,
          toDate: monthEnd
        };

        const subject = `${restaurant.restaurantName || 'Restaurant'} - Monthly Detailed Report - ${monthName} ${year}`;
        
        await sendDetailedReportEmail({
          restaurant,
          emailType: 'MONTHLY',
          dateRange,
          subject
        });

        console.log(`Monthly report sent to: ${restaurant.restaurantName} (${restaurant.email})`);

        // 4. Purge old data (Keep only current month and onwards for high-speed operation)
        await Promise.all([
          DailyLedger.deleteMany({
            restaurant: restaurant._id,
            date: { $lt: currentMonthStart }
          }),
          LedgerTransaction.deleteMany({
            restaurant: restaurant._id,
            transactionDate: { $lt: currentMonthStart }
          }),
          Order.deleteMany({
            restaurant: restaurant._id,
            createdAt: { $lt: currentMonthStart }
          })
        ]);

        console.log(`Successfully processed month-end for: ${restaurant.restaurantName}`);
      } catch (restaurantError) {
        console.error(`Error processing month-end for ${restaurant.restaurantName || restaurant.email}:`, restaurantError);
      }
    }
  } catch (error) {
    console.error('Critical error in end-of-month processing:', error);
    throw error;
  }
};

module.exports = {
  processEndOfMonth
};

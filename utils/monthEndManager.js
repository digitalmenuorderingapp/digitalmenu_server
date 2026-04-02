const RestaurantAdmin = require('../models/RestaurantAdmin');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const LedgerTransaction = require('../models/LedgerTransaction');
const excelService = require('../services/excel.service');
const emailService = require('../services/email.service');
const { monthlyReportTemplate } = require('../templates/monthlyReportTemplate');

/**
 * Core logic for processing end-of-month reports and data purging.
 * Updated for Final Clean Architecture (DailyLedger + LedgerTransaction).
 */
const processEndOfMonth = async () => {
  try {
    const restaurants = await RestaurantAdmin.find({});
    const now = new Date();
    
    // Calculate last month details
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthName = lastMonth.toLocaleString('default', { month: 'long' });
    const year = lastMonth.getFullYear();

    const monthStart = new Date(year, lastMonth.getMonth(), 1);
    const monthEnd = new Date(year, lastMonth.getMonth() + 1, 0, 23, 59, 59, 999);
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    console.log(`Starting month-end processing for ${monthName} ${year}...`);

    for (const restaurant of restaurants) {
      try {
        // 1. Fetch last month's data (Summaries and full audit transactions)
        const [dailyLedgers, transactions] = await Promise.all([
          DailyLedger.find({
            restaurant: restaurant._id,
            date: { $gte: monthStart, $lte: monthEnd }
          }).sort({ date: 1 }),
          LedgerTransaction.find({
            restaurant: restaurant._id,
            transactionDate: { $gte: monthStart, $lte: monthEnd }
          }).sort({ createdAt: 1 })
        ]);

        if (dailyLedgers.length === 0 && transactions.length === 0) {
          console.log(`Skipping restaurant ${restaurant.restaurantName}: No data for ${monthName}`);
          continue;
        }

        // 2. Aggregate monthly summary from DailyLedger records
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

        // 3. Generate Excel Reports
        // Note: excelService might need update if it specifically expects legacy ledger format, 
        // but transactional reports (Audit Journal) are better.
        const [ledgerBuffer, transBuffer] = await Promise.all([
          excelService.generateLedgerReport(dailyLedgers, summary, monthName, year),
          excelService.generateOrdersReport(transactions, monthName, year) // Using transactions as audit
        ]);

        // 4. Send Email with Attachments
        const ledgerFilename = `summary_${monthName}-${year}.xlsx`;
        const transFilename = `audit_audit_${monthName}-${year}.xlsx`;
        const subject = `${restaurant.restaurantName || 'Restaurant'} - Monthly Reports - ${monthName} ${year}`;
        
        const html = monthlyReportTemplate({
          restaurantName: restaurant.restaurantName,
          ownerName: restaurant.ownerName,
          monthName,
          year,
          summary
        });

        await emailService.sendEmailWithAttachments(
          restaurant.email,
          subject,
          '', 
          [
            { filename: ledgerFilename, content: ledgerBuffer },
            { filename: transFilename, content: transBuffer }
          ],
          html
        );

        // 5. Purge old data (Keep only current month and onwards for high-speed operation)
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

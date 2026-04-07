const RestaurantAdmin = require('../models/RestaurantAdmin');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const moment = require('moment-timezone');

/**
 * Utility to pause execution between tasks to prevent CPU spikes.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Step 1: Generate and email monthly reports for all restaurants.
 */
const processMonthlyReports = async (restaurantIds = []) => {
    try {
        const query = restaurantIds.length > 0 ? { _id: { $in: restaurantIds } } : {};
        const restaurants = await RestaurantAdmin.find(query);
        const now = moment().tz('Asia/Kolkata');
        
        // Calculate last month details
        const lastMonth = now.clone().subtract(1, 'month');
        const monthName = lastMonth.format('MMMM');
        const year = lastMonth.year();

        const monthStart = lastMonth.clone().startOf('month').toDate();
        const monthEnd = lastMonth.clone().endOf('month').toDate();

        console.log(`[MonthEnd] Starting monthly report generation for ${monthName} ${year}...`);

        for (const restaurant of restaurants) {
            try {
                // 1. Check if restaurant had any activity last month
                const ordersCount = await Order.countDocuments({
                    restaurant: restaurant._id,
                    createdAt: { $gte: monthStart, $lte: monthEnd }
                });

                if (ordersCount === 0) {
                    continue;
                }

                // 2. Trigger the unified report email logic
                const { sendDetailedReportEmail } = require('./reportHelper');
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

                console.log(`[MonthEnd] Report sent to: ${restaurant.restaurantName} (${restaurant.email})`);

                // 3. STAGGERED EXECUTION
                await sleep(5000);

            } catch (restaurantError) {
                console.error(`[MonthEnd] Error processing report for ${restaurant.restaurantName || restaurant.email}:`, restaurantError);
            }
        }
        console.log(`[MonthEnd] Monthly reports processing completed.`);
    } catch (error) {
        console.error('[MonthEnd] Critical error in monthly reports processing:', error);
        throw error;
    }
};

/**
 * Step 2: Purge historical data that is older than the current month.
 */
const purgeAllOldData = async () => {
    try {
        const now = moment().tz('Asia/Kolkata');
        const currentMonthStart = now.clone().startOf('month').toDate();
        
        console.log(`[MonthEnd] Starting global data purge (clearing data before ${moment(currentMonthStart).format('YYYY-MM-DD')})...`);

        // We purge in segments to prevent long-locking the DB
        const result = await Promise.all([
            DailyLedger.deleteMany({ date: { $lt: currentMonthStart } }),
            Order.deleteMany({ createdAt: { $lt: currentMonthStart } })
        ]);

        console.log(`[MonthEnd] Purge completed successfully.`);
        console.log(`[MonthEnd] Stats: Ledgers deleted: ${result[0].deletedCount}, Orders: ${result[1].deletedCount}`);
    } catch (error) {
        console.error('[MonthEnd] Critical error in data purge processing:', error);
        throw error;
    }
};

module.exports = {
    processMonthlyReports,
    purgeAllOldData
};

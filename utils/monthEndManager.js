const RestaurantAdmin = require('../models/RestaurantAdmin');
const DailyLedger = require('../models/DailyLedger');
const Order = require('../models/Order');
const moment = require('moment-timezone');
const ReportService = require('../services/report.service');
const { uploadRawToCloudinary } = require('./cloudinary');

/**
 * Utility to pause execution between tasks to prevent CPU spikes.
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Step 1: Generate and upload monthly reports to Cloudinary for all restaurants.
 */
const processMonthlyReports = async (restaurantIds = []) => {
    try {
        const query = restaurantIds.length > 0 ? { _id: { $in: restaurantIds } } : {};
        const restaurants = await RestaurantAdmin.find(query);
        const now = moment().tz('Asia/Kolkata');
        
        // Calculate last month details
        const lastMonth = now.clone().subtract(1, 'month');
        const monthIndex = lastMonth.month() + 1; // 1-indexed
        const monthName = lastMonth.format('MMMM');
        const year = lastMonth.year();

        const monthStart = lastMonth.clone().startOf('month').toDate();
        const monthEnd = lastMonth.clone().endOf('month').toDate();

        console.log(`[MonthEnd] Starting monthly report generation & upload for ${monthName} ${year}...`);

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

                // 2. Fetch all orders for the month to generate the report
                const orders = await Order.find({
                    restaurant: restaurant._id,
                    createdAt: { $gte: monthStart, $lte: monthEnd }
                }).sort({ createdAt: 1 }).lean({ virtuals: true });

                // 3. Generate the report buffer
                console.log(`[MonthEnd] Generating Excel buffer for ${restaurant.restaurantName}...`);
                const reportBuffer = await ReportService.generateReport(
                    restaurant,
                    orders,
                    {
                        dateRange: { 
                            from: moment(monthStart).format('YYYY-MM-DD'), 
                            to: moment(monthEnd).format('YYYY-MM-DD') 
                        },
                        reportType: 'Monthly',
                        includeOnlyVerified: true
                    }
                );

                // 4. Upload to Cloudinary
                const shortId = restaurant.shortId || restaurant._id.toString();
                const monthKey = `${year}-${String(monthIndex).padStart(2, '0')}`;
                const filename = `report-${monthKey}`;
                const folder = `digitalmenu/reports/${shortId}`;
                
                console.log(`[MonthEnd] Uploading to Cloudinary: ${folder}/${filename}...`);
                const uploadResult = await uploadRawToCloudinary(reportBuffer, filename, folder);
                
                // 5. Update RestaurantAdmin document
                // Ensure reports array exists
                if (!restaurant.reports) restaurant.reports = [];
                
                // Remove existing report for this exact month if it exists (for idempotency)
                restaurant.reports = restaurant.reports.filter(r => !(r.year === year && r.month === monthIndex));
                
                // Push new report details
                restaurant.reports.push({
                    year,
                    month: monthIndex,
                    url: uploadResult.secure_url,
                    publicId: uploadResult.public_id,
                    generatedAt: new Date()
                });

                await restaurant.save();

                console.log(`[MonthEnd] Report processed successfully for: ${restaurant.restaurantName} (ID: ${shortId})`);

                // 6. STAGGERED EXECUTION to prevent API rate limiting or CPU spikes
                await sleep(2000);

            } catch (restaurantError) {
                console.error(`[MonthEnd] Error processing report for ${restaurant.restaurantName || restaurant.email}:`, restaurantError.message);
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

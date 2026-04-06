const cron = require('node-cron');
const { processMonthlyReports, purgeAllOldData } = require('../utils/monthEndManager');
const https = require('https');
const http = require('http');

exports.initCron = () => {
  // --- MONTH END JOBS ---

  // 1. Generate & Email Monthly Reports
  // Run on the 1st day of every month at midnight (00:00:00)
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Cron] Triggering month-end report generation (1st of month)...');
    try {
      await processMonthlyReports();
      console.log('[Cron] Monthly reports processing completed.');
    } catch (error) {
      console.error('[Cron] Monthly reports processing failed:', error);
    }
  });

  // 2. Global Data Purge (5-Day Delay)
  // Run on the 6th day of every month at midnight (00:00:00)
  // This respects the 5-day window requested for data retention.
  cron.schedule('0 0 6 * *', async () => {
    console.log('[Cron] Triggering global data purge (6th of month)...');
    try {
      await purgeAllOldData();
      console.log('[Cron] Global data purge completed.');
    } catch (error) {
      console.error('[Cron] Global data purge failed:', error);
    }
  });


  // --- SYSTEM MAINTENANCE ---

  // 3. Keep-Awake Ping (Render Free Tier)
  // Runs every 14 minutes to stay within the 15-minute inactivity window.
  cron.schedule('*/14 * * * *', async () => {
    // Dynamic URL detection: Priority .env > Hardcoded Prod
    const backendUrl = process.env.BACKEND_URL || 'https://digitalmenu-server.onrender.com';
    if (!backendUrl) return;

    try {
      const protocol = backendUrl.startsWith('https') ? https : http;
      
      const req = protocol.get(`${backendUrl}/api/health`, (res) => {
        if (res.statusCode === 200) {
          // console.log(`[Cron] System is awake. Status: ${res.statusCode}`);
        } else {
          console.warn(`[Cron] Awake Ping unexpected status: ${res.statusCode}`);
        }
      });

      req.on('error', (err) => {
        console.error('[Cron] Awake Ping Request Failed:', err.message);
      });

      req.end();
    } catch (error) {
       console.error('[Cron] Keep-awake execution error:', error);
    }
  });

  console.log('[Cron] All scheduled services initialized (Reports on 1st, Purge on 6th, Awake-Ping every 14m)');
};

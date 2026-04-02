const cron = require('node-cron');
const { processEndOfMonth } = require('../utils/monthEndManager');

exports.initCron = () => {
  // Run on the 1st day of every month at midnight (00:00:00)
  // Pattern: minute hour dayOfMonth month dayOfWeek
  cron.schedule('0 0 1 * *', async () => {
    console.log('[Cron] Starting scheduled end-of-month processing...');
    try {
      await processEndOfMonth();
      console.log('[Cron] Scheduled end-of-month processing completed successfully.');
    } catch (error) {
      console.error('[Cron] Scheduled end-of-month processing failed:', error);
    }
  });

  // Self-ping to keep system awake (Render free tier)
  // Runs every 14 minutes to stay within the 15-minute window
  cron.schedule('*/14 * * * *', async () => {
    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) return;

    try {
      console.log(`[Cron] Pinging system to keep awake: ${backendUrl}/api/health`);
      // Using native fetch if available (Node 18+) or dynamic import for node-fetch is overkill
      // We can use a simple broad GET for now. 
      const https = require('https');
      const http = require('http');
      const protocol = backendUrl.startsWith('https') ? https : http;

      protocol.get(`${backendUrl}/api/health`, (res) => {
        console.log(`[Cron] Awake Ping Status: ${res.statusCode}`);
      }).on('error', (err) => {
        console.error('[Cron] Awake Ping Failed:', err.message);
      });
    } catch (error) {
       console.error('[Cron] Keep-awake error:', error);
    }
  });

  console.log('Cron services initialized.');
};

const mongoose = require('mongoose');

/**
 * Connect to MongoDB database
 * Also ensures superadmin account exists
 */
const connectDB = async () => {
  let attempt = 0;
  const baseDelay = 2000; // 2 seconds
  const maxDelay = 30000; // 30 seconds max
  const maxRetries = Infinity; // Retry indefinitely

  while (attempt < maxRetries) {
    attempt++;
    try {
      const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/digitalmenu');
      console.log(`✅ MongoDB Connected`);

      // Ensure Superadmin Account
      const Superadmin = require('../models/Superadmin');
      const superadminEmail = 'sahin401099@gmail.com';
      const existingSuperadmin = await Superadmin.findOne({ email: superadminEmail });

      if (!existingSuperadmin) {
        console.log('--- CREATING SUPERADMIN ACCOUNT ---');
        await Superadmin.create({
          email: superadminEmail,
          name: 'System Admin'
        });
        console.log(`✅ Superadmin account created: ${superadminEmail}`);
      }
      return; // Success, exit the retry loop
    } catch (error) {
      const delay = Math.min(baseDelay * Math.pow(2, attempt - 1), maxDelay);
      console.error(`❌ MongoDB Connection Failed (Attempt ${attempt}): ${error.message}`);
      
      const isTimeout = error.message.includes('ETIMEDOUT') || error.message.includes('timed out');
      const isWhitelistError = error.message.includes('IP address is not whitelisted') || error.message.includes('IP that isn\'t whitelisted');

      if (isTimeout) {
        console.error('👉 TIP: Your network might be blocking port 27017. Try a mobile hotspot or VPN.');
      } else if (isWhitelistError) {
        console.error('👉 Add your current IP to the MongoDB Atlas Network Access whitelist.');
      } else {
        console.error('👉 Check your environment variables and Atlas cluster status.');
      }
      
      console.log(`   Retrying in ${delay / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error('❌ MongoDB Connection Failed after all retries');
  if (process.env.NODE_ENV === 'production') {
    process.exit(1);
  }
};

module.exports = { connectDB };

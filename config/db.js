const mongoose = require('mongoose');

/**
 * Connect to MongoDB database
 * Also ensures superadmin account exists
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/digitalmenu');
    console.log(`MongoDB Connected`);

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
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = { connectDB };

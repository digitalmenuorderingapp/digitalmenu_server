const mongoose = require('mongoose');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const { generateShortId } = require('../utils/id.util');
require('dotenv').config();

const migrateShortIds = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const basicRestaurants = await RestaurantAdmin.find({ shortId: { $exists: false } });
    console.log(`Found ${basicRestaurants.length} restaurants without shortId`);

    for (const restaurant of basicRestaurants) {
      let shortId;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        shortId = generateShortId();
        const existing = await RestaurantAdmin.findOne({ shortId });
        if (!existing) isUnique = true;
        attempts++;
      }

      if (isUnique) {
        restaurant.shortId = shortId;
        await restaurant.save();
        console.log(`Assigned ${shortId} to ${restaurant.email}`);
      } else {
        console.error(`Failed to generate unique ID for ${restaurant.email} after 10 attempts`);
      }
    }

    console.log('Migration complete');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
};

migrateShortIds();

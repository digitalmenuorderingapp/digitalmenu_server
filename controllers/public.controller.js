const RestaurantAdmin = require('../models/RestaurantAdmin');
const MenuItem = require('../models/MenuItem');
const Table = require('../models/Table');

/**
 * @desc    Get restaurant details by ID for public view
 * @route   GET /api/public/restaurant/:id
 * @access  Public
 */
exports.getRestaurantDetails = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID is required'
      });
    }

    // Find restaurant by ID (lean for speed)
    const restaurant = await RestaurantAdmin.findById(id)
      .select('restaurantName ownerName email address phone motto logo')
      .lean();

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Return restaurant details
    res.status(200).json({
      success: true,
      data: {
        id: restaurant._id,
        restaurantName: restaurant.restaurantName || 'Restaurant',
        ownerName: restaurant.ownerName,
        email: restaurant.email,
        address: restaurant.address,
        phone: restaurant.phone,
        motto: restaurant.motto,
        logo: restaurant.logo
      }
    });

  } catch (error) {
    console.error('[PublicController] Error fetching restaurant:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * @desc    Get public menu for a restaurant
 * @route   GET /api/public/menu
 * @access  Public
 */
exports.getPublicMenu = async (req, res) => {
  try {
    const { restaurantId, table } = req.query;

    if (!restaurantId) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID is required'
      });
    }

    // Run queries in parallel for speed
    const [restaurant, menuItems, tableDoc] = await Promise.all([
      RestaurantAdmin.findById(restaurantId)
        .select('restaurantName ownerName logo motto')
        .lean(),
      MenuItem.find({ 
        restaurant: restaurantId,
        isActive: true 
      })
        .select('name description price images foodType isActive category isVeg isBestSeller')
        .sort({ category: 1, name: 1 })
        .lean(),
      table ? Table.findOne({ restaurant: restaurantId, tableNumber: table }).lean() : null
    ]);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Fast category grouping using object (single pass)
    const categorizedItems = {};
    for (const item of menuItems) {
      const category = item.category || 'Other';
      if (!categorizedItems[category]) {
        categorizedItems[category] = [];
      }
      categorizedItems[category].push(item);
    }

    res.status(200).json({
      success: true,
      data: {
        restaurant: {
          id: restaurant._id,
          restaurantName: restaurant.restaurantName || 'Restaurant',
          ownerName: restaurant.ownerName,
          logo: restaurant.logo,
          motto: restaurant.motto
        },
        tableNumber: table,
        tableCapacity: tableDoc?.seats || 8,
        menuItems: categorizedItems
      }
    });

  } catch (error) {
    console.error('[PublicController] Error fetching public menu:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * @desc    Verify QR code data
 * @route   POST /api/public/verify-qr
 * @access  Public
 */
exports.verifyQRCode = async (req, res) => {
  try {
    const { restaurantId, tableNumber } = req.body;

    if (!restaurantId || !tableNumber) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID and table number are required'
      });
    }

    // Run queries in parallel
    const [restaurant, tableDoc] = await Promise.all([
      RestaurantAdmin.findById(restaurantId)
        .select('restaurantName ownerName isActive')
        .lean(),
      Table.findOne({ restaurant: restaurantId, tableNumber }).lean()
    ]);

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        restaurantName: restaurant.restaurantName || 'Restaurant',
        restaurantId: restaurant._id,
        ownerName: restaurant.ownerName,
        tableNumber: tableNumber,
        tableCapacity: tableDoc?.seats || 8,
        verified: true
      }
    });

  } catch (error) {
    console.error('[PublicController] Error verifying QR:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

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

    // Find restaurant by ID
    const restaurant = await RestaurantAdmin.findById(id).select('restaurantName ownerName email address phone description logo');

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
        description: restaurant.description,
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

    // Find restaurant by ID
    const restaurant = await RestaurantAdmin.findById(restaurantId).select('restaurantName ownerName logo');

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Get menu items for this restaurant
    const menuItems = await MenuItem.find({ 
      restaurant: restaurantId,
      isActive: true 
    }).sort({ category: 1, name: 1 });

    // Group items by category
    const categorizedItems = menuItems.reduce((acc, item) => {
      const category = item.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(item);
      return acc;
    }, {});

    // Fetch table details if table number is provided
    let tableCapacity = 8; // Default
    if (table) {
      const tableDoc = await Table.findOne({ restaurant: restaurantId, tableNumber: table });
      if (tableDoc) {
        tableCapacity = tableDoc.seats;
      }
    }

    res.status(200).json({
      success: true,
      data: {
        restaurant: {
          id: restaurant._id,
          restaurantName: restaurant.restaurantName || 'Restaurant',
          ownerName: restaurant.ownerName,
          logo: restaurant.logo
        },
        tableNumber: table,
        tableCapacity: tableCapacity,
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

    // Find restaurant by ID
    const restaurant = await RestaurantAdmin.findById(restaurantId).select('restaurantName ownerName email isActive');

    if (!restaurant) {
      return res.status(404).json({
        success: false,
        message: 'Restaurant not found'
      });
    }

    // Fetch table details
    let tableCapacity = 8; // Default
    const tableDoc = await Table.findOne({ restaurant: restaurantId, tableNumber: tableNumber });
    if (tableDoc) {
      tableCapacity = tableDoc.seats;
    }

    res.status(200).json({
      success: true,
      data: {
        restaurantName: restaurant.restaurantName || 'Restaurant',
        restaurantId: restaurant._id,
        ownerName: restaurant.ownerName,
        tableNumber: tableNumber,
        tableCapacity: tableCapacity,
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

const MenuItem = require('../models/MenuItem');
const { uploadToCloudinary, extractPublicId, deleteFromCloudinary } = require('../utils/cloudinary');
const socketService = require('../services/socket.service');

// Get all menu items (admin)
exports.getAllMenuItems = async (req, res, next) => {
  try {
    const menuItems = await MenuItem.find({ restaurant: req.userId }).sort({ createdAt: -1 });
    res.json({
      success: true,
      count: menuItems.length,
      data: menuItems
    });
  } catch (error) {
    next(error);
  }
};

// Get active menu items (public)
exports.getPublicMenu = async (req, res, next) => {
  try {
    const { table, restaurantId } = req.query;
    
    // Fallback to params if query is not available
    const rId = restaurantId || req.params.restaurantId;

    if (!rId) {
      return res.status(400).json({
        success: false,
        message: 'Restaurant ID is required'
      });
    }
    
    const menuItems = await MenuItem.find({ 
      restaurant: rId, 
      isActive: true 
    }).sort({ name: 1 });
    
    res.json({
      success: true,
      table: table ? parseInt(table) : null,
      count: menuItems.length,
      data: menuItems
    });
  } catch (error) {
    next(error);
  }
};

// Alias for getPublicMenu (public)
exports.getMenu = exports.getPublicMenu;

// Get single menu item (public/admin)
exports.getMenuItem = async (req, res, next) => {
  try {
    const menuItem = await MenuItem.findById(req.params.id);
    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }
    res.json({
      success: true,
      data: menuItem
    });
  } catch (error) {
    next(error);
  }
};

// Create menu item
exports.createMenuItem = async (req, res, next) => {
  try {
    const { name, description, price, offerPrice, foodType } = req.body;
    
    let imageUrls = [];
    
    // Upload images if provided
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file => uploadToCloudinary(file.buffer));
      const results = await Promise.all(uploadPromises);
      imageUrls = results.map(result => result.secure_url);
    }
    
    const menuItem = await MenuItem.create({
      restaurant: req.userId,
      name,
      description,
      price: parseFloat(price),
      offerPrice: offerPrice ? parseFloat(offerPrice) : null,
      images: imageUrls,
      foodType: foodType || 'Main Course',
      isVeg: req.body.isVeg === 'true',
      isBestSeller: req.body.isBestSeller === 'true'
    });
    
    // Emit real-time menu update to restaurant customers
    socketService.emitToRoom(req.userId.toString(), 'menuUpdated', { 
      restaurantId: req.userId.toString(),
      action: 'create',
      menuItem 
    });
    
    
    res.status(201).json({
      success: true,
      message: 'Menu item created successfully',
      data: menuItem
    });
  } catch (error) {
    next(error);
  }
};

// Update menu item
exports.updateMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, price, offerPrice, isActive, foodType, removedImages } = req.body;
    
    const menuItem = await MenuItem.findOne({ _id: id, restaurant: req.userId });
    
    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }
    
    // Handle removed images
    if (removedImages) {
      const removedList = Array.isArray(removedImages) ? removedImages : [removedImages];
      for (const imgUrl of removedList) {
        if (menuItem.images.includes(imgUrl)) {
          const publicId = extractPublicId(imgUrl);
          if (publicId) {
            await deleteFromCloudinary(publicId);
          }
          menuItem.images = menuItem.images.filter(url => url !== imgUrl);
        }
      }
    }

    // Upload new images if provided
    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map(file => uploadToCloudinary(file.buffer));
      const results = await Promise.all(uploadPromises);
      const newUrls = results.map(result => result.secure_url);
      menuItem.images = [...menuItem.images, ...newUrls];
    }
    
    // Update fields
    if (name !== undefined) menuItem.name = name;
    if (description !== undefined) menuItem.description = description;
    if (price !== undefined) menuItem.price = parseFloat(price);
    if (offerPrice !== undefined) menuItem.offerPrice = offerPrice ? parseFloat(offerPrice) : null;
    if (isActive !== undefined) menuItem.isActive = isActive;
    if (foodType !== undefined) menuItem.foodType = foodType;
    if (req.body.isVeg !== undefined) menuItem.isVeg = req.body.isVeg === 'true';
    if (req.body.isBestSeller !== undefined) menuItem.isBestSeller = req.body.isBestSeller === 'true';
    
    await menuItem.save();
    
    // Emit real-time menu update to restaurant customers
    socketService.emitToRoom(req.userId.toString(), 'menuUpdated', { 
      restaurantId: req.userId.toString(),
      action: 'update',
      menuItem 
    });
    
    res.json({
      success: true,
      message: 'Menu item updated successfully',
      data: menuItem
    });
  } catch (error) {
    next(error);
  }
};

// Delete menu item
exports.deleteMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const menuItem = await MenuItem.findOne({ _id: id, restaurant: req.userId });
    
    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }
    
    // Delete images from Cloudinary
    if (menuItem.images && menuItem.images.length > 0) {
      for (const imageUrl of menuItem.images) {
        const publicId = extractPublicId(imageUrl);
        if (publicId) {
          await deleteFromCloudinary(publicId);
        }
      }
    }
    
    await MenuItem.findOneAndDelete({ _id: id, restaurant: req.userId });
    
    // Emit real-time menu update to restaurant customers
    socketService.emitToRoom(req.userId.toString(), 'menuUpdated', { 
      restaurantId: req.userId.toString(),
      action: 'delete',
      menuItemId: id 
    });
    
    
    res.json({
      success: true,
      message: 'Menu item deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Toggle menu item active status
exports.toggleMenuItem = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const menuItem = await MenuItem.findOne({ _id: id, restaurant: req.userId });
    
    if (!menuItem) {
      return res.status(404).json({
        success: false,
        message: 'Menu item not found'
      });
    }
    
    menuItem.isActive = !menuItem.isActive;
    await menuItem.save();
    
    // Emit real-time menu update to restaurant customers
    socketService.emitToRoom(req.userId.toString(), 'menuUpdated', { 
      restaurantId: req.userId.toString(),
      action: 'toggle',
      menuItem 
    });
    
    
    res.json({
      success: true,
      message: `Menu item ${menuItem.isActive ? 'activated' : 'deactivated'} successfully`,
      data: menuItem
    });
  } catch (error) {
    next(error);
  }
};

// Aliases for toggling
exports.toggleAvailability = exports.toggleMenuItem;
exports.toggleStock = exports.toggleMenuItem;

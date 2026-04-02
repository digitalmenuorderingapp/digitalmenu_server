const express = require('express');
const router = express.Router();
const menuController = require('../controllers/menu.controller');
const { protect } = require('../middleware/auth.middleware');
const upload = require('../utils/multer');
const { trackUserActivity } = require('../middleware/userTracker');

// Public routes
router.get('/', menuController.getPublicMenu); // Support query params
router.get('/:restaurantId', menuController.getMenu); // Support path params
router.get('/item/:id', menuController.getMenuItem);

// Protected admin routes
router.use(protect, trackUserActivity);

// Admin Get All
router.get('/admin/all', menuController.getAllMenuItems);

// CRUD
router.post('/', upload.single('image'), menuController.createMenuItem);
router.put('/:id', upload.single('image'), menuController.updateMenuItem);
router.delete('/:id', menuController.deleteMenuItem);

// Status Toggles
router.patch('/toggle/:id', menuController.toggleMenuItem); // Standard toggle
router.patch('/item/:id/toggle-availability', menuController.toggleAvailability);
router.patch('/item/:id/toggle-instock', menuController.toggleStock);

module.exports = router;

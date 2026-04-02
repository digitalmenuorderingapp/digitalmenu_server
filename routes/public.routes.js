const express = require('express');
const router = express.Router();
const { 
  getRestaurantDetails, 
  getPublicMenu, 
  verifyQRCode 
} = require('../controllers/public.controller');

/**
 * @route   GET /api/public/restaurant/:id
 * @desc    Get basic restaurant profile publicly
 */
router.get('/restaurant/:id', getRestaurantDetails);

/**
 * @route   GET /api/public/menu
 * @desc    Get categorized active menu items for a restaurant
 */
router.get('/menu', getPublicMenu);

/**
 * @route   POST /api/public/verify-qr
 * @desc    Verify QR scan data (restaurant and table)
 */
router.post('/verify-qr', verifyQRCode);

module.exports = router;

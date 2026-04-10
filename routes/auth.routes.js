const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateRegister, validateLogin } = require('../middleware/validation.middleware');
const { trackUserActivity } = require('../middleware/userTracker');
const upload = require('../utils/multer');

// Auth routes
router.post('/google-signin', authController.googleSignIn);
router.get('/google', authController.googleAuth);           // Initiate Google OAuth
router.get('/google/callback', authController.googleCallback); // Handle Google callback
router.post('/login', validateLogin, authController.login);
router.post('/logout', authController.logout);

// Set password (for Google users to create password for staff login)
router.post('/set-password', protect, authController.setPassword);
router.post('/refresh', authController.refresh);
router.get('/me', protect, trackUserActivity, authController.getMe);
router.get('/subscription', protect, authController.getSubscription);

// Active devices routes
router.get('/devices', protect, authController.listActiveDevices);
router.post('/logout-device', protect, authController.logoutDevice);

// Restaurant details route
router.put('/restaurant', protect, trackUserActivity, authController.updateRestaurant);
router.put('/restaurant/logo', protect, trackUserActivity, upload.single('logo'), authController.uploadLogo);
router.delete('/restaurant/logo', protect, trackUserActivity, authController.removeLogo);

// Reports (Legacy - moved to ledger routes if needed, or pending implementation)
// router.get('/reports/monthly/:year/:month', protect, authController.generateMonthlyReport);
// router.get('/reports/current', protect, authController.getCurrentMonthReport);
// router.get('/reports/download/:year/:month', protect, authController.downloadReport);

// Delete account (Captcha confirmation required)
router.post('/delete-account', protect, authController.deleteAccount);

module.exports = router;

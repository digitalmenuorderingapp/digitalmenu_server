const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateLogin } = require('../middleware/validation.middleware');
const { trackActivity } = require('../middleware/activity.middleware');
const upload = require('../utils/multer');

// Auth routes
router.post('/google-signin', authController.googleSignIn);
router.post('/login', validateLogin, authController.login);
router.post('/logout', authController.logout);

// Set password (for Google users to create password for staff login)
router.post('/set-password', protect, authController.setPassword);
router.post('/refresh', authController.refresh);
router.get('/me', protect, trackActivity, authController.getMe);
router.get('/subscription', protect, authController.getSubscription);

// Active devices routes
router.get('/devices', protect, authController.listActiveDevices);
router.post('/logout-device', protect, authController.logoutDevice);

// Restaurant details route
router.put('/restaurant', protect, trackActivity, authController.updateRestaurant);
router.put('/restaurant/logo', protect, trackActivity, upload.single('logo'), authController.uploadLogo);
router.delete('/restaurant/logo', protect, trackActivity, authController.removeLogo);

// Reports (Legacy - moved to ledger routes if needed, or pending implementation)
// router.get('/reports/monthly/:year/:month', protect, authController.generateMonthlyReport);
// router.get('/reports/current', protect, authController.getCurrentMonthReport);
// router.get('/reports/download/:year/:month', protect, authController.downloadReport);

// Delete account (Captcha confirmation required)
router.post('/delete-account', protect, authController.deleteAccount);

module.exports = router;

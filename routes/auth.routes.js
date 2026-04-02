const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateRegister, validateLogin } = require('../middleware/validation.middleware');
const { trackUserActivity } = require('../middleware/userTracker');
const upload = require('../utils/multer');

router.post('/register', validateRegister, authController.register);
router.post('/login', validateLogin, authController.login);
router.post('/logout', authController.logout);
router.post('/refresh', authController.refresh);
router.get('/me', protect, trackUserActivity, authController.getMe);

// OTP & Password Reset
router.post('/verify-otp', authController.verifyOtp);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);
router.post('/resend-otp', authController.resendOtp);

// Active devices routes
router.get('/devices', protect, authController.listActiveDevices);
router.post('/logout-device', protect, authController.logoutDevice);

// Restaurant details route
router.put('/restaurant', protect, trackUserActivity, authController.updateRestaurant);
router.put('/restaurant/logo', protect, trackUserActivity, upload.single('logo'), authController.uploadLogo);
router.delete('/restaurant/logo', protect, trackUserActivity, authController.removeLogo);

// Delete account routes

module.exports = router;

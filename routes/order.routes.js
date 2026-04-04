const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateOrder } = require('../middleware/validation.middleware');

const { trackUserActivity } = require('../middleware/userTracker');
const { checkSubscription } = require('../middleware/subscription');

// Public routes
router.post('/', validateOrder, checkSubscription, orderController.createOrder);
router.get('/device/:deviceId', orderController.getOrdersByDevice);
router.get('/public/:id', orderController.getOrderByIdPublic);
router.post('/public/:id/feedback', orderController.submitFeedback);
router.put('/:id/feedback', orderController.submitFeedback);
router.put('/device/profile', orderController.updateCustomerProfile); // Update customer profile on orders

// Customer cancel route (public with deviceId verification)
router.put('/:id/cancel', orderController.cancelOrder);

// Protected admin routes
router.use(protect, trackUserActivity);

// Report & Analytics
router.get('/', orderController.getAllOrders);
router.get('/table/:tableNumber', orderController.getOrdersByTable);
router.get('/:id', orderController.getOrderById);
router.put('/:id/status', checkSubscription, orderController.updateOrderStatus);
router.put('/:id/verify-payment', orderController.verifyPayment);
router.put('/:id/collect-payment', orderController.collectPayment);
router.put('/:id/reject', orderController.rejectOrder);
router.post('/:id/action', checkSubscription, orderController.handleOrderAction);
router.post('/:id/refund', orderController.processRefund);

module.exports = router;

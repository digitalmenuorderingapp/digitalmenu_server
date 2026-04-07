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
router.put('/:id/retry-payment', orderController.retryPayment);
router.post('/public/:id/apply-online-payment', orderController.applyOnlinePayment);
router.post('/public/:id/retry-payment', orderController.retryPayment);

// Customer cancel route (public with deviceId verification)
router.put('/:id/cancel', orderController.cancelOrder);

// Protected admin routes
router.use(protect, trackUserActivity);

// Report & Analytics
router.get('/', orderController.getAllOrders);
router.get('/table/:tableNumber', orderController.getOrdersByTable);
router.get('/:id', orderController.getOrderById);

// Order Management Actions
router.post('/:id/accept', checkSubscription, (req, res, next) => { 
  req.body.action = 'ACCEPT_ORDER'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/reject', checkSubscription, (req, res, next) => { 
  req.body.action = 'REJECT_ORDER'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/serve', checkSubscription, (req, res, next) => { 
  req.body.action = 'COMPLETE_ORDER'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/collect-payment', checkSubscription, (req, res, next) => { 
  req.body.action = 'COLLECT_PAYMENT'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/verify-payment', checkSubscription, (req, res, next) => { 
  req.body.action = 'VERIFY_PAYMENT'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/mark-unpaid', checkSubscription, (req, res, next) => { 
  req.body.action = 'MARK_UNPAID'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/clear-dues', checkSubscription, (req, res, next) => { 
  req.body.action = 'CLEAR_DUES'; 
  orderController.handleOrderAction(req, res, next); 
});
router.post('/:id/retry', checkSubscription, (req, res, next) => { 
  req.body.action = 'REQUEST_RETRY'; 
  orderController.handleOrderAction(req, res, next); 
});

// Flexible Action Dispatcher
router.post('/:id/action', checkSubscription, orderController.handleOrderAction);

module.exports = router;

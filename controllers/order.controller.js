const Order = require('../models/Order');
const LedgerTransaction = require('../models/LedgerTransaction');
const ledgerService = require('../services/ledger.service');
const excelHelper = require('../helpers/excel.helper');
const emailService = require('../services/email.service');
const { reportEmailTemplate } = require('../templates/reportEmail');
const RestaurantAdmin = require('../models/RestaurantAdmin');

// Helper to attach transactions to a single order
const getEnrichedOrder = async (order) => {
  const orderObj = order.toObject();
  orderObj.transactions = await LedgerTransaction.find({ orderId: order._id });
  return orderObj;
};

// Create order - Optimized for speed
exports.createOrder = async (req, res, next) => {
  try {
    const { 
      tableNumber, 
      customerName, 
      customerPhone,
      deviceId, 
      sessionId, 
      items, 
      totalAmount, 
      paymentMethod, 
      utrNumber, 
      restaurantId,
      orderType = 'dine-in',
      numberOfPersons,
      specialInstructions
    } = req.body;

    // 1. Create order (fast - single DB write)
    const order = await Order.create({
      restaurant: restaurantId || req.userId,
      tableNumber: orderType === 'dine-in' ? tableNumber : undefined,
      customerName,
      customerPhone,
      deviceId,
      sessionId,
      items,
      totalAmount,
      paymentMethod: paymentMethod || 'cash',
      utrNumber,
      orderType,
      numberOfPersons: orderType === 'dine-in' ? numberOfPersons : undefined,
      specialInstructions,
      status: 'placed'
    });

    // 2. Return response immediately (don't wait for async operations)
    const basicOrder = order.toObject();
    basicOrder.transactions = []; // Will be populated async

    res.status(201).json({
      success: true,
      message: 'Order placed successfully',
      data: basicOrder
    });

    // 3. Do async work AFTER response (non-blocking)
    // Fire-and-forget ledger recording
    ledgerService.recordTransaction({
      order,
      type: 'PAYMENT',
      amount: order.totalAmount,
      mode: order.paymentMethod,
      status: 'PENDING'
    }).catch(err => console.error('[OrderController] Failed to record transaction:', err));

    // Fire-and-forget socket emission
    const io = req.app.get('io');
    if (io) {
      const targetId = restaurantId || req.userId;
      const roomId = targetId?.toString();
      
      // Emit basic order immediately (admin can refresh for full data)
      io.to(roomId).emit('newOrder', basicOrder);
      io.to(roomId).emit('orderUpdate', basicOrder);
    }

  } catch (error) {
    next(error);
  }
};

// Get orders by device ID (for customer view)
exports.getOrdersByDevice = async (req, res, next) => {
  try {
    const { deviceId } = req.params;
    const { restaurantId, status } = req.query;

    const query = { deviceId };

    if (restaurantId) {
      query.restaurant = restaurantId;
    }

    // Filter by status if provided
    if (status && ['placed', 'preparing', 'served'].includes(status)) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(20);

    const enrichedOrders = await Promise.all(
      orders.map(o => getEnrichedOrder(o))
    );

    res.json({
      success: true,
      count: enrichedOrders.length,
      data: enrichedOrders
    });
  } catch (error) {
    next(error);
  }
};

// Update customer profile for all orders by device
exports.updateCustomerProfile = async (req, res, next) => {
  try {
    const { deviceId, customerName, customerPhone, numberOfPersons } = req.body;

    if (!deviceId) {
      return res.status(400).json({
        success: false,
        message: 'deviceId is required'
      });
    }

    // Update all pending orders for this device
    const result = await Order.updateMany(
      { 
        deviceId, 
        status: { $in: ['placed', 'preparing'] } // Only update active orders
      },
      {
        $set: {
          customerName: customerName || undefined,
          customerPhone: customerPhone || undefined,
          numberOfPersons: numberOfPersons || undefined
        }
      }
    );

    // Get updated orders to emit via socket
    const updatedOrders = await Order.find({
      deviceId,
      status: { $in: ['placed', 'preparing'] }
    });

    // Emit updates to restaurant admins
    const io = req.app.get('io');
    if (io && updatedOrders.length > 0) {
      const enrichedOrders = await Promise.all(
        updatedOrders.map(o => getEnrichedOrder(o))
      );
      
      // Group by restaurant and emit
      const ordersByRestaurant = enrichedOrders.reduce((acc, order) => {
        const restId = order.restaurant?.toString();
        if (!acc[restId]) acc[restId] = [];
        acc[restId].push(order);
        return acc;
      }, {});

      Object.entries(ordersByRestaurant).forEach(([restId, orders]) => {
        orders.forEach(order => {
          io.to(restId).emit('orderUpdate', order);
        });
      });
    }

    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} order(s) with new customer info`,
      modifiedCount: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};

// Get orders by table number (admin)
exports.getOrdersByTable = async (req, res, next) => {
  try {
    const { tableNumber } = req.params;

    const orders = await Order.find({ restaurant: req.userId, tableNumber })
      .sort({ createdAt: -1 })
      .limit(50);

    const orderIds = orders.map(o => o._id);
    const transactions = await LedgerTransaction.find({ orderId: { $in: orderIds } });

    const enrichedOrders = orders.map(o => {
      const orderObj = o.toObject();
      orderObj.transactions = transactions.filter(tx => 
        tx.orderId && tx.orderId.toString() === o._id.toString()
      );
      return orderObj;
    });

    res.json({
      success: true,
      count: enrichedOrders.length,
      data: enrichedOrders
    });
  } catch (error) {
    next(error);
  }
};

// Get all orders (admin)
exports.getAllOrders = async (req, res, next) => {
  try {
    const { search, status, date, month, year, paymentMethod } = req.query;

    // Build query - convert userId to ObjectId for aggregation compatibility
    const mongoose = require('mongoose');
    let query = { restaurant: new mongoose.Types.ObjectId(req.userId) };

    // Search by order number (5-digit) or table number
    if (search) {
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        // Search by orderNumber (exact match for 5-digit) or tableNumber
        query.$or = [
          { orderNumber: search },
          { tableNumber: searchNum }
        ];
      }
    }

    // Filter by status
    if (status && ['placed', 'preparing', 'served'].includes(status)) {
      query.status = status;
    }

    // Filter by payment method
    if (paymentMethod && ['cash', 'online'].includes(paymentMethod)) {
      query.paymentMethod = paymentMethod;
    }

    // Filter by single date or month range
    if (date) {
      const startOfDay = ledgerService.normalizeToISTMidnight(date);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
      query.createdAt = {
        $gte: startOfDay,
        $lte: endOfDay
      };
    } else if (month && year) {
      const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
      query.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }

    // 1. Fetch orders (limited) with lean for speed
    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // 2. Aggregate stats in MongoDB (single query, much faster)
    const statsPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          placed: { $sum: { $cond: [{ $eq: ['$status', 'placed'] }, 1, 0] } },
          preparing: { $sum: { $cond: [{ $eq: ['$status', 'preparing'] }, 1, 0] } },
          served: { $sum: { $cond: [{ $eq: ['$status', 'served'] }, 1, 0] } },
          rejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
          totalRevenue: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$status', 'served'] },
                  { $or: [
                    { $eq: [{ $ifNull: ['$refund.status', 'none'] }, 'none'] },
                    { $ne: ['$refund.status', 'refunded'] }
                  ]}
                ]},
                '$totalAmount',
                0
              ]
            }
          },
          onlinePending: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$paymentMethod', 'online'] },
                  { $eq: ['$paymentStatus', 'PENDING'] },
                  { $not: { $in: ['$status', ['rejected', 'cancelled']] } }
                ]},
                1,
                0
              ]
            }
          },
          cashPending: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$paymentMethod', 'cash'] },
                  { $eq: ['$paymentStatus', 'PENDING'] },
                  { $not: { $in: ['$status', ['rejected', 'cancelled']] } }
                ]},
                1,
                0
              ]
            }
          },
          totalRefunds: { $sum: { $cond: [{ $eq: ['$refund.status', 'refunded'] }, 1, 0] } },
          totalRefundAmount: { $sum: { $cond: [{ $eq: ['$refund.status', 'refunded'] }, '$refund.amount', 0] } },
          cashGross: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$paymentMethod', 'cash'] },
                  { $eq: ['$status', 'served'] },
                  { $or: [
                    { $eq: [{ $ifNull: ['$refund.status', 'none'] }, 'none'] },
                    { $ne: ['$refund.status', 'refunded'] }
                  ]}
                ]},
                '$totalAmount',
                0
              ]
            }
          },
          cashRefunded: { $sum: { $cond: [{ $eq: ['$refund.status', 'refunded'] }, { $cond: [{ $eq: ['$paymentMethod', 'cash'] }, '$refund.amount', 0] }, 0] } },
          onlineGross: {
            $sum: {
              $cond: [
                { $and: [
                  { $eq: ['$paymentMethod', 'online'] },
                  { $eq: ['$status', 'served'] },
                  { $or: [
                    { $eq: [{ $ifNull: ['$refund.status', 'none'] }, 'none'] },
                    { $ne: ['$refund.status', 'refunded'] }
                  ]}
                ]},
                '$totalAmount',
                0
              ]
            }
          },
          onlineRefunded: { $sum: { $cond: [{ $eq: ['$refund.status', 'refunded'] }, { $cond: [{ $eq: ['$paymentMethod', 'online'] }, '$refund.amount', 0] }, 0] } }
        }
      }
    ];

    const [statsResult] = await Order.aggregate(statsPipeline);
    const stats = statsResult || {
      totalOrders: 0, placed: 0, preparing: 0, served: 0, rejected: 0, cancelled: 0,
      totalRevenue: 0, onlinePending: 0, cashPending: 0, totalRefunds: 0, totalRefundAmount: 0,
      cashGross: 0, cashRefunded: 0, onlineGross: 0, onlineRefunded: 0
    };

    // Attach transactions for each order (batch query)
    const orderIds = orders.map(o => o._id);
    const transactions = orderIds.length > 0 
      ? await LedgerTransaction.find({ orderId: { $in: orderIds } }).lean()
      : [];

    const enrichedOrders = orders.map(o => ({
      ...o,
      transactions: transactions.filter(tx => 
        tx.orderId && tx.orderId.toString() === o._id.toString()
      )
    }));

    res.json({
      success: true,
      count: enrichedOrders.length,
      data: enrichedOrders,
      stats: stats
    });
  } catch (error) {
    next(error)
  }
};

// Update order status
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const validStatuses = ['placed', 'preparing', 'served'];

    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status'
      });
    }

    const order = await Order.findOneAndUpdate(
      { _id: id, restaurant: req.userId },
      { status },
      { new: true }
    );

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Update summary when order is served (for Analytics only, no financial change)
    if (status === 'served') {
      try {
        await ledgerService.syncDailyLedger(req.userId, order.createdAt);
      } catch (ledgerError) {
        console.error('Failed to sync summary on order served:', ledgerError);
      }
    }

    // Emit real-time event to customer device and admin
    const enrichedOrder = await getEnrichedOrder(order);

    const io = req.app.get('io');
    if (io) {
      const adminRoom = order.restaurant.toString();
      const customerRoom = order.deviceId;
      
      console.log(`[Socket] Order update emitted: ${id} status: ${status}`);
      io.to(customerRoom).emit('orderStatusUpdate', enrichedOrder);
      io.to(adminRoom).emit('orderUpdate', enrichedOrder);
    }

    res.json({
      success: true,
      message: 'Order status updated successfully',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Get single order by ID
exports.getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const enrichedOrder = await getEnrichedOrder(order);

    res.json({
      success: true,
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Get single order by ID (public)
exports.getOrderByIdPublic = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    const enrichedOrder = await getEnrichedOrder(order);

    res.json({
      success: true,
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Submit feedback for order
exports.submitFeedback = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    // Validate rating
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    // Validate comment length
    if (comment && comment.length > 500) {
      return res.status(400).json({
        success: false,
        message: 'Comment must be less than 500 characters'
      });
    }

    const order = await Order.findById(id);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Only allow feedback for served orders
    if (order.status !== 'served') {
      return res.status(400).json({
        success: false,
        message: 'Feedback can only be submitted for served orders'
      });
    }

    // Update feedback
    order.feedback = {
      rating,
      comment: comment || '',
      submittedAt: new Date()
    };

    await order.save();

    const enrichedOrder = await getEnrichedOrder(order);

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Verify online payment
exports.verifyPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { utrNumber } = req.body;

    const order = await Order.findOne({ _id: id, restaurant: req.userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.paymentMethod !== 'online') {
      return res.status(400).json({
        success: false,
        message: 'This order is not an online payment order'
      });
    }

    if (order.paymentStatus === 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: 'Payment already verified'
      });
    }

    // Update payment verification
    order.paymentStatus = 'VERIFIED';
    if (utrNumber) {
      order.utrNumber = utrNumber;
    }

    await order.save();

    // Verify existing TRANSACTION and Sync
    try {
      const LedgerTransaction = require('../models/LedgerTransaction');
      await LedgerTransaction.updateMany(
        { orderId: order._id, type: 'PAYMENT' },
        { status: 'VERIFIED' }
      );
      await ledgerService.syncDailyLedger(req.userId, order.createdAt);
    } catch (ledgerError) {
      console.error('Failed to update ledger on payment verification:', ledgerError);
    }

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit update to admin and customer
    const io = req.app.get('io');
    if (io) {
      const adminRoom = (order.restaurant || req.userId)?.toString();
      const customerRoom = order.deviceId;
      io.to(adminRoom).emit('orderUpdate', enrichedOrder);
      if (customerRoom) {
        io.to(customerRoom).emit('orderStatusUpdate', enrichedOrder);
        io.to(customerRoom).emit('paymentVerified', enrichedOrder);
      }
      console.log(`[Socket] Payment verified emitted: ${order._id} room: ${adminRoom}`);
    }

    res.json({
      success: true,
      message: 'Payment verified successfully',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Mark cash as collected
exports.collectCash = async (req, res, next) => {
  try {
    const { id } = req.params;

    const order = await Order.findOne({ _id: id, restaurant: req.userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    if (order.paymentMethod !== 'cash') {
      return res.status(400).json({
        success: false,
        message: 'This order is not a cash payment order'
      });
    }

    if (order.paymentStatus === 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: 'Order already marked as paid'
      });
    }

    order.paymentStatus = 'VERIFIED'; // For cash, collection = verified
    await order.save();

    // Verify existing TRANSACTION and Sync
    try {
      const LedgerTransaction = require('../models/LedgerTransaction');
      await LedgerTransaction.updateMany(
        { orderId: order._id, type: 'PAYMENT' },
        { status: 'VERIFIED' }
      );
      await ledgerService.syncDailyLedger(req.userId, order.createdAt);
    } catch (ledgerError) {
      console.error('Failed to verify transaction:', ledgerError);
    }

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit update to admin and customer
    const io = req.app.get('io');
    if (io) {
      const adminRoom = (order.restaurant || req.userId)?.toString();
      const customerRoom = order.deviceId;
      io.to(adminRoom).emit('orderUpdate', enrichedOrder);
      if (customerRoom) {
        io.to(customerRoom).emit('orderStatusUpdate', enrichedOrder);
        io.to(customerRoom).emit('paymentVerified', enrichedOrder);
      }
      console.log(`[Socket] Cash collected emitted: ${order._id} room: ${adminRoom}`);
    }

    res.json({
      success: true,
      message: 'Cash marked as collected',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Reject order (admin)
exports.rejectOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const order = await Order.findOne({ _id: id, restaurant: req.userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Can only reject placed orders (not preparing or served)
    if (order.status !== 'placed') {
      return res.status(400).json({
        success: false,
        message: 'Can only reject orders that have not been approved yet'
      });
    }

    // Guard against double-processing if the order was already rejected
    if (order.status === 'rejected') {
      return res.status(400).json({ success: false, message: 'Order is already rejected' });
    }

    order.status = 'rejected';
    order.rejectionReason = reason || 'Order rejected by admin';
    
    // Auto-Refund if it was already verified
    if (order.paymentStatus === 'VERIFIED') {
      order.refund = {
        status: 'refunded',
        method: order.paymentMethod,
        amount: order.totalAmount,
        processedAt: new Date()
      };
    }
    
    await order.save();

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit update to admin and customer
    const io = req.app.get('io');
    if (io) {
      const adminRoom = order.restaurant.toString();
      const customerRoom = order.deviceId;
      console.log(`[Socket] Order rejected: ${id}`);
      io.to(adminRoom).emit('orderUpdate', enrichedOrder);
      io.to(customerRoom).emit('orderStatusUpdate', enrichedOrder);
    }

    // Financial Logic: Revert the payment with a REFUND transaction
    if (order.paymentStatus === 'VERIFIED') {
      try {
        await ledgerService.recordTransaction({
          order,
          type: 'REFUND',
          amount: -order.totalAmount,
          mode: order.paymentMethod,
          status: 'VERIFIED' // Reversal is immediate
        });
      } catch (ledgerError) {
        console.error('Failed to record reversal:', ledgerError);
      }
    }


    res.json({
      success: true,
      message: 'Order rejected',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Cancel order (customer)
exports.cancelOrder = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { deviceId, reason } = req.query;
    const { reason: bodyReason } = req.body || {};

    const query = { _id: id };

    // If deviceId provided, verify customer owns this order
    if (deviceId) {
      query.deviceId = deviceId;
    }

    const order = await Order.findOne(query);

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Can only cancel placed orders (not preparing, served, or already cancelled/rejected)
    if (order.status !== 'placed') {
      return res.status(400).json({
        success: false,
        message: 'Can only cancel orders that have not been approved yet'
      });
    }

    // Guard against double-processing if the order was already cancelled
    if (order.status === 'cancelled') {
      return res.status(400).json({ success: false, message: 'Order is already cancelled' });
    }

    order.status = 'cancelled';
    order.cancellationReason = reason || bodyReason || 'Order cancelled by customer';
    
    // Auto-Refund if it was already verified
    if (order.paymentStatus === 'VERIFIED') {
      order.refund = {
        status: 'refunded',
        method: order.paymentMethod,
        amount: order.totalAmount,
        processedAt: new Date()
      };
    }
    
    await order.save();

    // Financial Logic: Revert the payment with a REFUND transaction
    if (order.paymentStatus === 'VERIFIED') {
      try {
        await ledgerService.recordTransaction({
          order,
          type: 'REFUND',
          amount: -order.totalAmount,
          mode: order.paymentMethod,
          status: 'VERIFIED'
        });
      } catch (ledgerError) {
        console.error('Failed to record reversal on cancellation:', ledgerError);
      }
    }

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit real-time event to restaurant admin and customer
    const io = req.app.get('io');
    if (io) {
      io.to(order.restaurant.toString()).emit('orderUpdate', enrichedOrder);
      io.to(order.restaurant.toString()).emit('orderCancelled', enrichedOrder);
      io.to(order.deviceId).emit('orderStatusUpdate', enrichedOrder);
    }

    res.json({
      success: true,
      message: 'Order cancelled',
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Process refund for cancelled/rejected orders
exports.processRefund = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { refundMethod, refundAmount } = req.body;

    const order = await Order.findOne({ _id: id, restaurant: req.userId });

    if (!order) {
      return res.status(404).json({
        success: false,
        message: 'Order not found'
      });
    }

    // Can only refund cancelled or rejected orders that were paid
    if (!['cancelled', 'rejected'].includes(order.status)) {
      return res.status(400).json({
        success: false,
        message: 'Can only refund cancelled or rejected orders'
      });
    }

    if (order.paymentStatus !== 'VERIFIED') {
      return res.status(400).json({
        success: false,
        message: 'Order was not paid, no refund needed'
      });
    }

    if (order.refund && order.refund.status === 'refunded') {
      return res.status(400).json({
        success: false,
        message: 'Order has already been refunded'
      });
    }

    // Validate refund amount
    const amount = parseFloat(refundAmount);
    if (isNaN(amount) || amount <= 0 || amount > order.totalAmount) {
      return res.status(400).json({
        success: false,
        message: 'Invalid refund amount'
      });
    }

    // Update order with refund details
    order.refund = {
        status: 'refunded',
        method: refundMethod,
        amount: amount,
        processedAt: new Date()
    };
    await order.save();

    // Record Refund Transaction
    try {
      await ledgerService.recordTransaction({
        order,
        type: 'REFUND',
        amount: -amount,
        mode: refundMethod,
        status: 'VERIFIED'
      });
    } catch (ledgerError) {
      console.error('Failed to record refund transaction:', ledgerError);
    }

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit real-time event to restaurant admin and customer
    const io = req.app.get('io');
    if (io) {
      io.to(order.restaurant.toString()).emit('orderUpdate', enrichedOrder);
      io.to(order.deviceId).emit('orderRefundUpdate', enrichedOrder);
      io.to(order.deviceId).emit('orderStatusUpdate', enrichedOrder);
    }

    res.json({
      success: true,
      message: `Refund of ₹${amount.toFixed(2)} processed successfully`,
      data: enrichedOrder
    });
  } catch (error) {
    next(error);
  }
};

// Send Monthly Orders Report via Email
exports.sendReportEmail = async (req, res, next) => {
  try {
    const restaurantId = req.userId;
    const user = await RestaurantAdmin.findById(restaurantId);

    if (!user) {
      return res.status(404).json({ success: false, message: 'Restaurant not found' });
    }

    // Define Date Range: Month Start to Now
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfRange = now;

    const orders = await Order.find({
      restaurant: restaurantId,
      createdAt: { $gte: startOfMonth, $lte: endOfRange }
    }).sort({ createdAt: 1 });

    // Prepare Excel Data
    const columns = [
      { header: 'Order No' },
      { header: 'Date' },
      { header: 'Time' },
      { header: 'Customer' },
      { header: 'Table' },
      { header: 'Method' },
      { header: 'Status' },
      { header: 'Amount' },
      { header: 'Items' }
    ];

    const rows = orders.map(o => [
      o.orderNumber || 'N/A',
      new Date(o.createdAt).toLocaleDateString('en-IN'),
      new Date(o.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      o.customerName,
      o.tableNumber,
      o.paymentMethod.toUpperCase(),
      o.status.toUpperCase(),
      o.totalAmount,
      o.items.map(i => `${i.name} (x${i.quantity})`).join(', ')
    ]);

    const periodStr = `${startOfMonth.toLocaleDateString('en-IN')} - ${endOfRange.toLocaleDateString('en-IN')}`;

    const excelBuffer = await excelHelper.createStyledWorkbook({
      sheetName: 'Orders History',
      reportTitle: 'Monthly Orders Analysis',
      restaurantName: user.restaurantName || 'Your Restaurant',
      period: periodStr,
      columns,
      rows
    });

    // Prepare Email Content
    const summary = {
      'Total Orders': orders.length,
      'Total Revenue': `₹${orders.filter(o => o.status === 'served').reduce((sum, o) => sum + o.totalAmount, 0).toFixed(2)}`,
      'Served Orders': orders.filter(o => o.status === 'served').length,
      'Cancelled/Rejected': orders.filter(o => ['cancelled', 'rejected'].includes(o.status)).length
    };

    const html = reportEmailTemplate({
      restaurantName: user.restaurantName || 'Partner',
      reportType: 'Orders History',
      period: periodStr,
      summary
    });

    await emailService.sendEmailWithAttachments(
      user.email,
      `Monthly Orders Report - ${user.restaurantName}`,
      `Your Monthly Orders Report for ${periodStr} is attached.`,
      [{
        filename: `Orders_Report_${now.getFullYear()}_${now.getMonth() + 1}.xlsx`,
        content: excelBuffer
      }],
      html
    );

    res.json({
      success: true,
      message: `Report successfully sent to ${user.email}`
    });
  } catch (error) {
    next(error);
  }
};

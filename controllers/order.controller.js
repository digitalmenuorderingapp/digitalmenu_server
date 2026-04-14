const Order = require('../models/Order');
const ledgerService = require('../services/ledger.service');
const excelHelper = require('../helpers/excel.helper');
const emailService = require('../services/email.service');
const RestaurantAdmin = require('../models/RestaurantAdmin');
const notificationService = require('../services/notification.service');

// Helper to attach transactions to a single order
const getEnrichedOrder = async (order) => {
  // Handle both Mongoose documents (have toObject) and plain objects from .lean()
  if (order.toObject) {
    return order.toObject({ virtuals: true });
  }
  return order; // Already a plain object from .lean()
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
      utr,
      restaurantId,
      orderType = 'dine-in',
      numberOfPersons,
      specialInstructions
    } = req.body;

    // 1. Create order
    const order = await Order.create({
      restaurant: restaurantId || req.userId,
      tableNumber: orderType === 'dine-in' ? tableNumber : undefined,
      customerName,
      customerPhone,
      deviceId,
      sessionId,
      items,
      totalAmount,
      paymentVerificationRequestbycustomer: {
        applied: paymentMethod === 'ONLINE',
        appliedUTR: (paymentMethod === 'ONLINE' && utr) ? utr.substring(0, 6) : ''
      },
      utr: utr ? utr.substring(0, 6) : '',
      orderType,
      numberOfPersons: orderType === 'dine-in' ? numberOfPersons : undefined,
      specialInstructions,
      status: 'PLACED',
      // Add metadata for admin-created orders to prevent duplicate notifications
      createdBy: req.userId || null,
      source: req.userId ? 'admin' : 'customer'
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
    // Fire-and-forget socket emission
    const io = req.app.get('io');
    if (io) {
      const targetId = restaurantId || req.userId;
      const roomId = targetId?.toString();

      // Persist and emit notification
      await notificationService.send({
        recipient: roomId,
        recipientType: 'ADMIN',
        type: 'ORDER_NEW',
        title: 'New Order Received',
        message: `Order #${order.orderNumber} placed for Table #${order.tableNumber}`,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          amount: order.totalAmount,
          orderData: basicOrder
        }
      });
    }

  } catch (error) {
    next(error);
  }
};

// ---------------------------------------------------------
// CENTRALIZED ORDER ACTIONS (State Machine)
// ---------------------------------------------------------
exports.handleOrderAction = async (req, res, next) => {
  try {
    const { id: orderId } = req.params;
    const { action, payload = {} } = req.body;
    const adminId = req.userId;
    console.log(`[Action] Received action: ${action} for order: ${orderId}`);

    const order = await Order.findById(orderId);
    if (!order) return res.status(404).json({ success: false, message: "Order not found" });

    const update = {};
    const now = new Date();
    let isPaymentAction = false;

    switch (action) {
      case "VERIFY_PAYMENT":
        if (order.collectedVia !== 'ONLINE' && order.paymentMethod !== 'ONLINE') {
          return res.status(400).json({ success: false, message: "Only ONLINE payments can be verified." });
        }
        update.paymentStatus = "VERIFIED";
        update.collectedVia = "ONLINE";
        update.collectedAt = new Date();
        update.utr = payload.utr ? payload.utr.toString().slice(-6) : (order.paymentVerificationRequestbycustomer?.appliedUTR || order.utr);
        update.paymentVerificationRequestbycustomer = undefined;

        isPaymentAction = true;
        break;

      case "REQUEST_RETRY":
        if (order.collectedVia !== 'ONLINE' && order.paymentMethod !== 'ONLINE') {
          return res.status(400).json({ success: false, message: "Only ONLINE payments can be marked for retry." });
        }
        if (order.paymentStatus === 'VERIFIED') {
          return res.status(400).json({ success: false, message: "Payment is already verified. Retry not needed." });
        }
        update.paymentStatus = "PENDING";
        update.paymentVerificationRequestbycustomer = {
          applied: false, // Customer must re-apply with new UTR
          adminAskedretry: true,
          retrycount: (order.paymentVerificationRequestbycustomer?.retrycount || 0) + 1
        };
        break;

      case "MARK_UNPAID":
        if (!payload.reason) return res.status(400).json({ success: false, message: "Reason is required to mark as unpaid." });
        update.paymentStatus = "UNPAID";
        update.unpaidReason = payload.reason;
        update.utr = undefined; // Clear UTR on unpaid status
        update.paymentVerificationRequestbycustomer = undefined; // Clear retry state

        isPaymentAction = true;
        break;

      case "ACCEPT_ORDER":
        if (order.status !== 'PLACED') {
          return res.status(400).json({ success: false, message: "Only PLACED orders can be accepted." });
        }
        update.status = "ACCEPTED";

        isPaymentAction = true;
        break;

      case "REJECT_ORDER":
        if (["COMPLETED", "REJECTED", "CANCELLED"].includes(order.status)) {
          return res.status(400).json({ success: false, message: `Cannot reject order in ${order.status} state.` });
        }
        update.status = "REJECTED";
        update.rejectionReason = payload.reason || "Order rejected by admin";
        break;



      case "COMPLETE_ORDER": // SERVE
        if (!["ACCEPTED", "PLACED"].includes(order.status)) {
          return res.status(400).json({ success: false, message: "Order must be PLACED or ACCEPTED to be served." });
        }
        update.status = "COMPLETED";
        break;

      case "COLLECT_PAYMENT":
        if (!['CASH', 'ONLINE'].includes(payload.method)) {
          return res.status(400).json({ success: false, message: "Invalid collection method. Use CASH or ONLINE." });
        }
        update.paymentStatus = "VERIFIED";
        update.collectedVia = payload.method;
        update.collectedAt = new Date();
        if (payload.method === 'ONLINE') {
          update.utr = payload.utr ? payload.utr.toString().slice(-6) : (order.paymentVerificationRequestbycustomer?.appliedUTR || order.utr);
        } else {
          update.utr = undefined; // Clear UTR for CASH collection
        }
        update.paymentVerificationRequestbycustomer = undefined;

        isPaymentAction = true;
        break;

      case "CLEAR_DUES":
        const clearMethod = payload.method || "CASH";
        update.paymentStatus = "VERIFIED";
        update.collectedVia = clearMethod;
        update.collectedAt = new Date();
        if (clearMethod === 'ONLINE') {
          update.utr = payload.utr ? payload.utr.toString().slice(-6) : (order.paymentVerificationRequestbycustomer?.appliedUTR || order.utr);
        } else {
          update.utr = undefined; // Clear UTR for CASH clearing
        }
        update.paymentVerificationRequestbycustomer = undefined;

        isPaymentAction = true;
        break;

      default:
        return res.status(400).json({ success: false, message: "Invalid action type." });
    }

    // Perform Update
    const updatedOrder = await Order.findByIdAndUpdate(
      orderId,
      { $set: update },
      { new: true }
    );

    // Sync with Ledger if verified payment or status change occurs
    const syncRelevantStates = ['COMPLETED', 'REJECTED', 'ACCEPTED'];
    if (isPaymentAction || syncRelevantStates.includes(update.status)) {
      ledgerService.recordTransaction({
        order: updatedOrder,
        createdAt: updatedOrder.createdAt
      }).catch(err => console.error('[OrderController] Ledger sync failed:', err));
    }

    const enrichedOrder = await getEnrichedOrder(updatedOrder);

    // Socket Emissions
    const io = req.app.get('io');
    if (io) {
      const room = enrichedOrder.restaurant.toString();

      // Map action to specific types for better UI handling
      const typeMap = {
        'ACCEPT_ORDER': 'ORDER_ACCEPTED',
        'REJECT_ORDER': 'ORDER_REJECTED',
        'COMPLETE_ORDER': 'ORDER_COMPLETED',
        'VERIFY_PAYMENT': 'PAYMENT_VERIFIED',
        'COLLECT_PAYMENT': 'PAYMENT_VERIFIED',
        'REQUEST_RETRY': 'PAYMENT_RETRY',
        'CLEAR_DUES': 'PAYMENT_VERIFIED'
      };

      const notificationType = typeMap[action] || 'ORDER_UPDATE';

      const getNotificationMessage = () => {
        if (action === 'COLLECT_PAYMENT' || action === 'VERIFY_PAYMENT' || action === 'CLEAR_DUES') {
          return `Payment ${update.paymentStatus === 'VERIFIED' ? 'verified' : 'updated'} for Order #${order.orderNumber}`;
        }
        if (action === 'REQUEST_RETRY') {
          return `Payment retry requested for Order #${order.orderNumber}`;
        }
        return `Order status changed to ${update.status || order.status} via ${action}`;
      };

      // Construct more descriptive message
      let displayMessage = `Order status changed to ${update.status || order.status}`;
      if (action === 'ACCEPT_ORDER') displayMessage = `Order #${order.orderNumber} Accepted for Table #${order.tableNumber}`;
      else if (action === 'REJECT_ORDER') displayMessage = `Order #${order.orderNumber} Rejected: ${update.rejectionReason}`;
      else if (action === 'COMPLETE_ORDER') displayMessage = `Order #${order.orderNumber} Served/Completed`;
      else if (action === 'VERIFY_PAYMENT' || action === 'COLLECT_PAYMENT' || action === 'CLEAR_DUES') displayMessage = `Payment Received for Order #${order.orderNumber} (Table #${order.tableNumber})`;
      else if (action === 'REQUEST_RETRY') displayMessage = `Payment Retry requested for Order #${order.orderNumber}`;

      // Notification for Admin
      await notificationService.send({
        recipient: room,
        recipientType: 'ADMIN',
        type: notificationType,
        title: `Order #${order.orderNumber} Updated`,
        message: displayMessage,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          tableNumber: order.tableNumber,
          orderData: enrichedOrder
        }
      });

      // Notification for Customer (Device)
      if (order.deviceId) {
        const customerMessage = notificationType === 'PAYMENT_RETRY'
          ? 'Verification failed. Please retry payment. 🔁'
          : `Your order is now ${update.status || order.status}`;

        await notificationService.send({
          recipient: order.deviceId,
          recipientType: 'CUSTOMER',
          type: notificationType,
          title: notificationType === 'PAYMENT_RETRY' ? 'Payment Verification' : 'Order Update',
          message: customerMessage,
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            orderData: enrichedOrder
          }
        });
      }
    }

    return res.json({ success: true, data: enrichedOrder });

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
    if (status && ['PLACED', 'ACCEPTED', 'COMPLETED', 'CANCELLED', 'REJECTED'].includes(status)) {
      query.status = status;
    }

    // Projection for faster queries - only get needed fields
    const projection = {
      _id: 1, orderNumber: 1, tableNumber: 1, customerName: 1, numberOfPersons: 1,
      orderType: 1, totalAmount: 1, status: 1, paymentStatus: 1, paymentMethod: 1,
      collectedVia: 1, createdAt: 1, updatedAt: 1, items: 1, deviceId: 1, utr: 1,
      specialInstructions: 1, paymentDueStatus: 1, rejectionReason: 1,
      cancellationReason: 1, unpaidReason: 1, feedback: 1, restaurant: 1
    };

    const orders = await Order.find(query)
      .select(projection)
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

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

      for (const [restId, orders] of Object.entries(ordersByRestaurant)) {
        for (const order of orders) {
          await notificationService.send({
            recipient: restId,
            recipientType: 'ADMIN',
            type: 'ORDER_UPDATE',
            title: 'Customer Profile Updated',
            message: `Customer info updated for Order #${order.orderNumber}`,
            metadata: {
              orderId: order._id,
              orderNumber: order.orderNumber,
              orderData: order
            }
          });
        }
      }
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

    const enrichedOrders = orders.map(o => o.toObject({ virtuals: true }));

    res.json({
      success: true,
      count: enrichedOrders.length,
      data: enrichedOrders
    });
  } catch (error) {
    next(error);
  }
};

// Get all orders (admin) - Optimized with optional stats
exports.getAllOrders = async (req, res, next) => {
  try {
    const { search, status, paymentStatus, date, month, year, paymentMethod, includeStats = 'true' } = req.query;

    // Build query - safely handle req.userId
    const mongoose = require('mongoose');
    if (!req.userId) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }
    
    let userId;
    try {
      userId = typeof req.userId === 'string' ? new mongoose.Types.ObjectId(req.userId) : req.userId;
    } catch (e) {
      console.error('[GEAllOrders] Invalid userId format:', req.userId);
      return res.status(400).json({ success: false, message: 'Invalid user identity' });
    }

    let query = { restaurant: userId };

    // Search by order number (5-digit) or table number
    if (search) {
      const searchNum = parseInt(search);
      if (!isNaN(searchNum)) {
        query.$or = [
          { orderNumber: search },
          { tableNumber: searchNum }
        ];
      }
    }

    // Filter by status
    if (status) {
      const statusArray = status.split(',').map(s => s.trim().toUpperCase());
      query.status = { $in: statusArray };
    }

    // Filter by payment status
    if (paymentStatus) {
      const payStatusArray = paymentStatus.split(',').map(s => s.trim().toUpperCase());
      query.paymentStatus = { $in: payStatusArray };
    }

    // Filter by payment method
    if (paymentMethod && ['cash', 'online'].includes(paymentMethod)) {
      query.paymentMethod = paymentMethod;
    }

    // Filter by single date or month range
    if (date) {
      const startOfDay = ledgerService.normalizeToISTMidnight(date);
      const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000 - 1);
      query.createdAt = { $gte: startOfDay, $lte: endOfDay };
    } else if (month && year) {
      const startOfMonth = new Date(parseInt(year), parseInt(month) - 1, 1);
      const endOfMonth = new Date(parseInt(year), parseInt(month), 0, 23, 59, 59);
      query.createdAt = { $gte: startOfMonth, $lte: endOfMonth };
    }

    // Projection for faster queries
    const projection = {
      _id: 1, orderNumber: 1, tableNumber: 1, customerName: 1, numberOfPersons: 1,
      orderType: 1, totalAmount: 1, status: 1, paymentStatus: 1, paymentMethod: 1,
      collectedVia: 1, createdAt: 1, updatedAt: 1, items: 1, deviceId: 1, utr: 1,
      specialInstructions: 1, paymentDueStatus: 1, rejectionReason: 1,
      cancellationReason: 1, unpaidReason: 1, feedback: 1,
      paymentVerificationRequestbycustomer: 1
    };

    // 1. Fetch orders with projection (much faster)
    const orders = await Order.find(query)
      .select(projection)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();

    // 2. Calculate stats only if requested (saves time when just viewing orders)
    let stats = null;
    if (includeStats === 'true') {
      const statsPipeline = [
        { $match: query },
        { $limit: 5000 }, // Limit for stats calculation
        {
          $group: {
            _id: null,
            totalOrders: { $sum: 1 },
            placed: { $sum: { $cond: [{ $eq: ['$status', 'PLACED'] }, 1, 0] } },
            accepted: { $sum: { $cond: [{ $eq: ['$status', 'ACCEPTED'] }, 1, 0] } },
            servingPending: { $sum: { $cond: [{ $in: ['$status', ['PLACED', 'ACCEPTED']] }, 1, 0] } },
            completed: { $sum: { $cond: [{ $eq: ['$status', 'COMPLETED'] }, 1, 0] } },
            rejected: { $sum: { $cond: [{ $eq: ['$status', 'REJECTED'] }, 1, 0] } },
            cancelled: { $sum: { $cond: [{ $eq: ['$status', 'CANCELLED'] }, 1, 0] } },
            totalRevenue: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'VERIFIED'] }, '$totalAmount', 0] } },
            unpaidDuesAmount: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'UNPAID'] }, '$totalAmount', 0] } },
            duesPending: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'UNPAID'] }, 1, 0] } },
            onlinePending: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentMethod', 'ONLINE'] }, { $ne: ['$paymentStatus', 'VERIFIED'] }] }, 1, 0] } },
            onlinePendingAmount: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentMethod', 'ONLINE'] }, { $ne: ['$paymentStatus', 'VERIFIED'] }] }, '$totalAmount', 0] } },
            cashPending: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentMethod', 'CASH'] }, { $ne: ['$paymentStatus', 'VERIFIED'] }] }, 1, 0] } },
            cashPendingAmount: { $sum: { $cond: [{ $and: [{ $eq: ['$paymentMethod', 'CASH'] }, { $ne: ['$paymentStatus', 'VERIFIED'] }] }, '$totalAmount', 0] } },
            counterGross: { $sum: { $cond: [{ $and: [{ $eq: ['$collectedVia', 'CASH'] }, { $eq: ['$paymentStatus', 'VERIFIED'] }] }, '$totalAmount', 0] } },
            onlineGross: { $sum: { $cond: [{ $and: [{ $eq: ['$collectedVia', 'ONLINE'] }, { $eq: ['$paymentStatus', 'VERIFIED'] }] }, '$totalAmount', 0] } }
          }
        }
      ];

      const [statsResult] = await Order.aggregate(statsPipeline);
      stats = statsResult || {
        totalOrders: 0, placed: 0, accepted: 0, completed: 0, rejected: 0, cancelled: 0,
        servingPending: 0, totalRevenue: 0, onlinePending: 0, onlinePendingAmount: 0,
        cashPending: 0, cashPendingAmount: 0, duesPending: 0, unpaidDuesAmount: 0,
        counterGross: 0, onlineGross: 0
      };
    }

    res.json({
      success: true,
      data: orders,
      stats: stats || undefined
    });
  } catch (error) {
    next(error);
  }
};



// Retry/Update payment (Customer)
exports.retryPayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { paymentMethod, utr, deviceId } = req.body;

    const order = await Order.findOne({ _id: id, deviceId });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    // Update payment details
    if (paymentMethod) {
      order.collectedVia = paymentMethod;
    }
    if (paymentMethod === 'ONLINE') {
      if (!order.paymentVerificationRequestbycustomer) order.paymentVerificationRequestbycustomer = {};
      order.paymentVerificationRequestbycustomer.applied = paymentMethod === 'ONLINE';
      order.paymentVerificationRequestbycustomer.adminAskedretry = false; // Reset when customer submits new UTR
      order.paymentVerificationRequestbycustomer.appliedUTR = (paymentMethod === 'ONLINE' && utr) ? utr.substring(0, 6) : order.paymentVerificationRequestbycustomer.appliedUTR;
    }

    order.paymentStatus = 'PENDING';
    order.isCollected = false;
    order.paymentVerificationRequestbycustomer.retrycount = (order.paymentVerificationRequestbycustomer.retrycount || 0) + 1;

    await order.save();

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit update to admin only (not to customer - they just submitted payment)
    const io = req.app.get('io');
    if (io) {
      const adminRoom = order.restaurant.toString();

      await notificationService.send({
        recipient: adminRoom,
        recipientType: 'ADMIN',
        type: 'PAYMENT_RETRY',
        title: 'Payment Update (Retry)',
        message: `Customer updated payment for Order #${order.orderNumber}`,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          orderData: enrichedOrder
        }
      });
    }

    res.json({ success: true, message: 'Payment updated successfully', data: enrichedOrder });
  } catch (error) {
    next(error);
  }
};

// Apply Online Payment (Customer)
exports.applyOnlinePayment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { utr, deviceId } = req.body;

    if (!utr || utr.length < 6) {
      return res.status(400).json({ success: false, message: 'Valid 6-digit UTR is mandatory for online payments.' });
    }

    const order = await Order.findOne({ _id: id, deviceId });

    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found or access denied.' });
    }

    // Update payment details to Online
    order.collectedVia = 'ONLINE';
    if (!order.paymentVerificationRequestbycustomer) order.paymentVerificationRequestbycustomer = {};
    order.paymentVerificationRequestbycustomer.applied = true;
    order.paymentVerificationRequestbycustomer.appliedUTR = utr.substring(0, 6);
    order.paymentStatus = 'PENDING';
    order.isCollected = false;
    order.paymentVerificationRequestbycustomer.retrycount = (order.paymentVerificationRequestbycustomer.retrycount || 0) + 1;

    await order.save();

    const enrichedOrder = await getEnrichedOrder(order);

    // Emit update events
    const io = req.app.get('io');
    if (io) {
      const adminRoom = order.restaurant.toString();
      const customerRoom = order.deviceId;

      await notificationService.send({
        recipient: adminRoom,
        recipientType: 'ADMIN',
        type: 'PAYMENT_VERIFIED', // Technically verification requested
        title: 'Online Payment Applied',
        message: `UTR: ${utr} applied for Order #${order.orderNumber}`,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          orderData: enrichedOrder
        }
      });

      if (customerRoom) {
        await notificationService.send({
          recipient: customerRoom,
          recipientType: 'CUSTOMER',
          type: 'PAYMENT_VERIFIED',
          title: 'Payment Sent',
          message: 'Online payment applied. Waiting for restaurant verification.',
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            orderData: enrichedOrder
          }
        });
      }
    }

    res.json({
      success: true,
      message: 'Online payment applied successfully. Please wait for restaurant verification.',
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

    // Can only cancel placed orders
    if (order.status === 'CANCELLED') {
      return res.status(400).json({ success: false, message: 'Order is already cancelled' });
    }

    if (order.status !== 'PLACED') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel order once it is being prepared or completed'
      });
    }

    order.status = 'CANCELLED';
    order.cancellationReason = reason || bodyReason || 'Order cancelled by customer';

    await order.save();


    const enrichedOrder = await getEnrichedOrder(order);

    // Emit real-time event to restaurant admin and customer
    const io = req.app.get('io');
    if (io) {
      const adminRoom = order.restaurant.toString();
      const customerRoom = order.deviceId;

      await notificationService.send({
        recipient: adminRoom,
        recipientType: 'ADMIN',
        type: 'ORDER_CANCELLED',
        title: 'Order Cancelled',
        message: `Order #${order.orderNumber} cancelled by customer`,
        metadata: {
          orderId: order._id,
          orderNumber: order.orderNumber,
          orderData: enrichedOrder
        }
      });

      if (customerRoom) {
        await notificationService.send({
          recipient: customerRoom,
          recipientType: 'CUSTOMER',
          type: 'ORDER_CANCELLED',
          title: 'Order Cancelled',
          message: 'Your order has been cancelled',
          metadata: {
            orderId: order._id,
            orderNumber: order.orderNumber,
            orderData: enrichedOrder
          }
        });
      }
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



// Get order by ID (Public - no auth required)
exports.getOrderByIdPublic = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const enrichedOrder = await getEnrichedOrder(order);
    res.json({ success: true, data: enrichedOrder });
  } catch (error) {
    next(error);
  }
};

// Get order by ID (Admin - requires auth)
exports.getOrderById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const order = await Order.findOne({ _id: id, restaurant: req.userId });
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }
    const enrichedOrder = await getEnrichedOrder(order);
    res.json({ success: true, data: enrichedOrder });
  } catch (error) {
    next(error);
  }
};

// Submit feedback for an order
exports.submitFeedback = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rating, comment, deviceId } = req.body;

    const query = { _id: id };
    if (deviceId) query.deviceId = deviceId;

    const order = await Order.findOne(query);
    if (!order) {
      return res.status(404).json({ success: false, message: 'Order not found' });
    }

    order.feedback = {
      rating,
      comment,
      submittedAt: new Date()
    };

    await order.save();

    const enrichedOrder = await getEnrichedOrder(order);
    res.json({ success: true, message: 'Feedback submitted successfully', data: enrichedOrder });
  } catch (error) {
    next(error);
  }
};

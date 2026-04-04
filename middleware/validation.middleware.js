const { body, validationResult } = require('express-validator');

// Handle validation errors
exports.handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      }))
    });
  }
  next();
};

// Auth validators
exports.validateRegister = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  exports.handleValidationErrors
];

exports.validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
  exports.handleValidationErrors
];

// Menu item validators
exports.validateMenuItem = [
  body('name')
    .notEmpty()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Name is required and must be less than 100 characters'),
  body('price')
    .isFloat({ min: 0 })
    .withMessage('Price must be a positive number'),
  body('offerPrice')
    .optional()
    .isFloat({ min: 0 })
    .withMessage('Offer price must be a positive number'),
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  body('ingredients')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Ingredients must be less than 300 characters'),
  body('preparationMethod')
    .optional()
    .trim()
    .isLength({ max: 300 })
    .withMessage('Preparation method must be less than 300 characters'),
  exports.handleValidationErrors
];

// Table validators
exports.validateTable = [
  body('tableNumber')
    .isInt({ min: 1 })
    .withMessage('Table number must be a positive integer'),
  exports.handleValidationErrors
];

// Order validators
exports.validateOrder = [
  body('tableNumber')
    .if(body('orderType').equals('dine-in'))
    .isInt({ min: 1 })
    .withMessage('Table number must be a positive integer for dine-in orders'),
  body('customerName')
    .notEmpty()
    .trim()
    .withMessage('Customer name is required'),
  body('customerPhone')
    .optional({ checkFalsy: true })
    .isMobilePhone('any')
    .withMessage('Please provide a valid phone number'),
  body('deviceId')
    .notEmpty()
    .trim()
    .withMessage('Device ID is required'),
  body('sessionId')
    .notEmpty()
    .trim()
    .withMessage('Session ID is required'),
  body('orderType')
    .optional()
    .isIn(['dine-in', 'takeaway', 'delivery'])
    .withMessage('Order type must be dine-in, takeaway, or delivery'),
  body('numberOfPersons')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('Number of persons must be between 1 and 20'),
  body('specialInstructions')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Special instructions must be less than 500 characters'),
  body('items')
    .isArray({ min: 1 })
    .withMessage('Order must have at least one item'),
  body('items.*.itemId')
    .notEmpty()
    .withMessage('Item ID is required'),
  body('items.*.name')
    .notEmpty()
    .trim()
    .withMessage('Item name is required'),
  body('items.*.price')
    .isFloat({ min: 0 })
    .withMessage('Item price must be a positive number'),
  body('items.*.quantity')
    .isInt({ min: 1 })
    .withMessage('Quantity must be at least 1'),
  body('totalAmount')
    .isFloat({ min: 0 })
    .withMessage('Total amount must be a positive number'),
  body('paymentMethod')
    .optional()
    .isIn(['COUNTER', 'ONLINE', 'cash', 'online'])
    .withMessage('Payment method must be COUNTER or ONLINE'),
  body('utr')
    .optional()
    .isString()
    .isLength({ max: 6 })
    .withMessage('UTR must be 6 characters or less'),
  exports.handleValidationErrors
];

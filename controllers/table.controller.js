const QRCode = require('qrcode');
const Table = require('../models/Table');

const FRONTEND_URL = process.env.ADMIN_URL || 'http://localhost:7000';

// Get all tables
exports.getAllTables = async (req, res, next) => {
  try {
    const tables = await Table.find({ restaurant: req.userId }).sort({ tableNumber: 1 });
    res.json({
      success: true,
      count: tables.length,
      data: tables
    });
  } catch (error) {
    next(error);
  }
};

// Create table with QR code
exports.createTable = async (req, res, next) => {
  try {
    const { tableNumber, seats  } = req.body;
    
    // Check if table already exists for this restaurant
    const existingTable = await Table.findOne({ restaurant: req.userId, tableNumber });
    if (existingTable) {
      return res.status(400).json({
        success: false,
        message: 'Table with this number already exists'
      });
    }
    
    // Generate QR code URL
    const menuUrl = `${FRONTEND_URL}/customer/menu?table=${tableNumber}`;
    
    // Generate QR code data URL
    const qrCode = await QRCode.toDataURL(menuUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    const table = await Table.create({
      restaurant: req.userId,
      tableNumber,
      seats,
      qrCode
    });
    
    res.status(201).json({
      success: true,
      message: 'Table created successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Get table by ID
exports.getTableById = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const table = await Table.findOne({ _id: id, restaurant: req.userId });
    
    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }
    
    res.json({
      success: true,
      data: table
    });
  } catch (error) {
    next(error);
  }
};

// Get QR code for table
exports.getTableQR = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const table = await Table.findOne({ _id: id, restaurant: req.userId });
    
    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }
    
    const menuUrl = `${FRONTEND_URL}/customer/menu?table=${table.tableNumber}`;
    
    res.json({
      success: true,
      data: {
        tableNumber: table.tableNumber,
        qrCode: table.qrCode,
        menuUrl
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete table
exports.deleteTable = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const table = await Table.findOne({ _id: id, restaurant: req.userId });
    
    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }
    
    await Table.findOneAndDelete({ _id: id, restaurant: req.userId });
    
    res.json({
      success: true,
      message: 'Table deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Regenerate QR code
exports.regenerateQR = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const table = await Table.findOne({ _id: id, restaurant: req.userId });
    
    if (!table) {
      return res.status(404).json({
        success: false,
        message: 'Table not found'
      });
    }
    
    const menuUrl = `${FRONTEND_URL}/customer/menu?table=${table.tableNumber}`;
    
    const qrCode = await QRCode.toDataURL(menuUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    });
    
    table.qrCode = qrCode;
    await table.save();
    
    res.json({
      success: true,
      message: 'QR code regenerated successfully',
      data: table
    });
  } catch (error) {
    next(error);
  }
};

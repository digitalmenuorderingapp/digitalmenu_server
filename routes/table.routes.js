const express = require('express');
const router = express.Router();
const tableController = require('../controllers/table.controller');
const { protect } = require('../middleware/auth.middleware');
const { validateTable } = require('../middleware/validation.middleware');

router.get('/', protect, tableController.getAllTables);
router.post('/', protect, validateTable, tableController.createTable);
router.get('/:id', protect, tableController.getTableById);
router.get('/:id/qr', protect, tableController.getTableQR);
router.delete('/:id', protect, tableController.deleteTable);
router.post('/:id/regenerate-qr', protect, tableController.regenerateQR);

module.exports = router;

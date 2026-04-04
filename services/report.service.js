const xlsx = require('xlsx');
const moment = require('moment-timezone');

/**
 * Format currency as ₹ with 2 decimals
 */
const formatCurrency = (amount) => {
  if (amount === null || amount === undefined) return '₹0.00';
  return `₹${Number(amount).toFixed(2)}`;
};

/**
 * Format date to IST string
 */
const formatDateIST = (date) => {
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD');
};

/**
 * Format time to IST string
 */
const formatTimeIST = (date) => {
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('HH:mm:ss');
};

/**
 * Format datetime to IST string
 */
const formatDateTimeIST = (date) => {
  if (!date) return '';
  return moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD HH:mm:ss');
};

/**
 * Flatten items array into readable string
 */
const formatItemsSummary = (items) => {
  if (!items || !Array.isArray(items) || items.length === 0) return '';
  return items.map(i => `${i.name} x${i.quantity}`).join(', ');
};

/**
 * Generate internal hash
 */
const generateInternalHash = (orderId, amount, timestamp) => {
  if (!orderId || !timestamp) return '';
  const data = `${orderId.toString()}_${amount}_${new Date(timestamp).getTime()}`;
  return Buffer.from(data).toString('base64').substring(0, 20);
};

/**
 * Create header info for report
 */
const createHeaderInfo = (restaurant, dateRange, reportType) => {
  const generatedAt = formatDateTimeIST(new Date());
  
  return [
    ['Digital Menu - Detailed Report'],
    [''],
    ['Restaurant Name:', restaurant.restaurantName || 'N/A'],
    ['Restaurant Address:', restaurant.address || 'N/A'],
    ['Short ID:', restaurant.shortId || 'N/A'],
    ['Report Type:', reportType],
    ['Date Range:', `${dateRange.from} to ${dateRange.to}`],
    ['Generated At:', generatedAt],
    ['Timezone:', 'IST (Asia/Kolkata)'],
    ['']
  ];
};

/**
 * Create transactions sheet data
 */
const createTransactionsSheet = (transactions, ordersMap, includeOnlyVerified = true) => {
  const headers = [
    'Date', 'Time', 'Timestamp', 'Order Number', 'Order ID', 'Transaction ID',
    'Order Type', 'Table Number', 'Customer Name', 'Customer Phone', 'Number of Persons',
    'Items Summary', 'Total Items Count', 'Unique Items Count',
    'Transaction Type', 'Payment Mode', 'Payment Method', 'UTR', 'Retry Count',
    'Payment Status', 'Collected Via', 'Collected At', 'Collected By',
    'Order Status', 'Status Updated At', 'Order Duration (mins)', 'Rejection Reason', 'Cancellation Reason',
    'Amount', 'Online Amount', 'Cash Amount', 'Refund Amount', 'Running Balance', 'Monthly Balance', 'Payment Due Status',
    'Device ID', 'Session ID', 'Created At', 'Updated At', 'Internal Hash'
  ];

  const data = [headers];
  let runningBalance = 0;

  // Filter and sort transactions
  let filteredTransactions = transactions;
  if (includeOnlyVerified) {
    filteredTransactions = transactions.filter(t => t.status === 'VERIFIED');
  }
  
  // Sort by transactionDate ASC
  filteredTransactions.sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));

  filteredTransactions.forEach((tx) => {
    const order = ordersMap.get(tx.orderId?.toString()) || {};
    
    // Calculate amounts
    const amount = tx.amount || 0;
    const onlineAmount = tx.paymentMode === 'ONLINE' ? amount : 0;
    const cashAmount = tx.paymentMode === 'CASH' ? amount : 0;
    const refundAmount = tx.type === 'REFUND' ? Math.abs(amount) : 0;
    
    // Update running balance
    runningBalance += amount;

    // Get last status update
    const statusHistory = order.statusHistory || [];
    const lastStatusUpdate = statusHistory.length > 0 
      ? statusHistory[statusHistory.length - 1].updatedAt 
      : order.updatedAt;

    // Order duration in minutes
    const orderDuration = order.orderDuration || 
      (order.status === 'COMPLETED' && order.updatedAt && order.createdAt 
        ? Math.floor((new Date(order.updatedAt) - new Date(order.createdAt)) / (1000 * 60))
        : null);

    const row = [
      formatDateIST(tx.transactionDate),
      formatTimeIST(tx.transactionDate),
      tx.transactionDate ? new Date(tx.transactionDate).toISOString() : '',
      order.orderNumber || tx.meta?.orderNumber || '',
      tx.orderId?.toString() || '',
      tx._id?.toString() || '',
      (order.orderType || 'DINE-IN').toUpperCase(),
      order.tableNumber || tx.meta?.tableNumber || '',
      order.customerName || '',
      order.customerPhone || '',
      order.numberOfPersons || 1,
      formatItemsSummary(order.items),
      order.items?.reduce((sum, i) => sum + (i.quantity || 0), 0) || 0,
      order.items?.length || 0,
      tx.type,
      tx.paymentMode,
      order.paymentMethod || '',
      order.utr || tx.meta?.utr || '',
      order.retryCount || 0,
      order.paymentStatus || '',
      order.collectedVia || '',
      order.collectedAt ? formatDateTimeIST(order.collectedAt) : '',
      order.collectedBy?.toString() || '',
      order.status || '',
      lastStatusUpdate ? formatDateTimeIST(lastStatusUpdate) : '',
      orderDuration || '',
      order.rejectionReason || '',
      order.cancellationReason || '',
      formatCurrency(amount),
      formatCurrency(onlineAmount),
      formatCurrency(cashAmount),
      formatCurrency(refundAmount),
      formatCurrency(runningBalance),
      formatCurrency(tx.monthlyNetBalance || runningBalance),
      order.paymentDueStatus || 'CLEAR',
      order.deviceId || tx.meta?.deviceId || '',
      order.sessionId || '',
      order.createdAt ? formatDateTimeIST(order.createdAt) : '',
      order.updatedAt ? formatDateTimeIST(order.updatedAt) : '',
      generateInternalHash(tx.orderId, amount, tx.transactionDate)
    ];

    data.push(row);
  });

  // Add summary at bottom
  const totals = filteredTransactions.reduce((acc, tx) => {
    const amount = tx.amount || 0;
    acc.totalTransactions++;
    if (tx.type === 'REFUND') {
      acc.totalRefund += Math.abs(amount);
    } else {
      if (tx.paymentMode === 'ONLINE') acc.totalOnline += amount;
      if (tx.paymentMode === 'CASH') acc.totalCash += amount;
    }
    return acc;
  }, { totalTransactions: 0, totalOnline: 0, totalCash: 0, totalRefund: 0 });

  data.push([]);
  data.push(['SUMMARY']);
  data.push(['Total Orders:', new Set(filteredTransactions.map(t => t.orderId?.toString()).filter(Boolean)).size]);
  data.push(['Total Transactions:', totals.totalTransactions]);
  data.push(['Total Online Amount:', formatCurrency(totals.totalOnline)]);
  data.push(['Total Cash Amount:', formatCurrency(totals.totalCash)]);
  data.push(['Total Refund Amount:', formatCurrency(totals.totalRefund)]);
  data.push(['Net Balance:', formatCurrency(totals.totalOnline + totals.totalCash - totals.totalRefund)]);
  data.push(['Pending Amount:', formatCurrency(filteredTransactions.filter(t => t.status === 'PENDING').reduce((sum, t) => sum + (t.amount || 0), 0))]);
  data.push(['Retry Count:', filteredTransactions.reduce((sum, t) => sum + ((t.meta?.retryCount) || 0), 0)]);

  return data;
};

/**
 * Create daily summary sheet
 */
const createDailySummarySheet = (transactions, includeOnlyVerified = true) => {
  const headers = ['Date', 'Total Orders', 'Total Transactions', 'Online Total', 'Cash Total', 'Refund Total', 'Net Balance'];
  
  let filteredTransactions = transactions;
  if (includeOnlyVerified) {
    filteredTransactions = transactions.filter(t => t.status === 'VERIFIED');
  }

  // Group by date
  const dailyMap = new Map();
  
  filteredTransactions.forEach(tx => {
    const date = formatDateIST(tx.transactionDate);
    if (!dailyMap.has(date)) {
      dailyMap.set(date, { 
        orders: new Set(), 
        transactions: 0, 
        online: 0, 
        cash: 0, 
        refund: 0 
      });
    }
    
    const day = dailyMap.get(date);
    if (tx.orderId) day.orders.add(tx.orderId.toString());
    day.transactions++;
    
    if (tx.type === 'REFUND') {
      day.refund += Math.abs(tx.amount || 0);
    } else {
      if (tx.paymentMode === 'ONLINE') day.online += tx.amount || 0;
      if (tx.paymentMode === 'CASH') day.cash += tx.amount || 0;
    }
  });

  // Sort by date ASC
  const sortedDates = Array.from(dailyMap.keys()).sort();
  
  const data = [headers];
  sortedDates.forEach(date => {
    const day = dailyMap.get(date);
    data.push([
      date,
      day.orders.size,
      day.transactions,
      formatCurrency(day.online),
      formatCurrency(day.cash),
      formatCurrency(day.refund),
      formatCurrency(day.online + day.cash - day.refund)
    ]);
  });

  return data;
};

/**
 * Create items breakdown sheet
 */
const createItemsBreakdownSheet = (transactions, ordersMap, includeOnlyVerified = true) => {
  const headers = ['Order Number', 'Date', 'Item Name', 'Quantity', 'Price', 'Total'];
  const data = [headers];

  let filteredTransactions = transactions;
  if (includeOnlyVerified) {
    filteredTransactions = transactions.filter(t => t.status === 'VERIFIED');
  }

  filteredTransactions.forEach(tx => {
    const order = ordersMap.get(tx.orderId?.toString());
    if (!order || !order.items) return;

    order.items.forEach(item => {
      data.push([
        order.orderNumber || tx.meta?.orderNumber || '',
        formatDateIST(tx.transactionDate),
        item.name,
        item.quantity,
        formatCurrency(item.price),
        formatCurrency(item.price * item.quantity)
      ]);
    });
  });

  return data;
};

/**
 * Create payment summary sheet
 */
const createPaymentSummarySheet = (transactions, includeOnlyVerified = true) => {
  const headers = ['Payment Status', 'Transaction Count', 'Total Amount'];
  const data = [headers];

  let filteredTransactions = transactions;
  if (includeOnlyVerified) {
    filteredTransactions = transactions.filter(t => t.status === 'VERIFIED');
  }

  // Get unique order payment statuses
  const summary = {
    'VERIFIED': { count: 0, amount: 0 },
    'PENDING': { count: 0, amount: 0 },
    'RETRY': { count: 0, amount: 0 },
    'UNPAID': { count: 0, amount: 0 }
  };

  filteredTransactions.forEach(tx => {
    const order = tx.order || {};
    const status = order.paymentStatus || 'PENDING';
    if (summary[status]) {
      summary[status].count++;
      summary[status].amount += tx.amount || 0;
    }
  });

  Object.entries(summary).forEach(([status, info]) => {
    if (info.count > 0) {
      data.push([status, info.count, formatCurrency(info.amount)]);
    }
  });

  return data;
};

/**
 * Generate full Excel report
 */
const generateReport = async (restaurant, transactions, orders, options = {}) => {
  const { 
    dateRange, 
    reportType = 'Monthly',
    includeOnlyVerified = true 
  } = options;

  // Create orders map for quick lookup
  const ordersMap = new Map();
  orders.forEach(order => {
    ordersMap.set(order._id.toString(), order);
  });

  // Create workbook
  const wb = xlsx.utils.book_new();

  // Sheet 1: Header + Transactions
  const headerInfo = createHeaderInfo(restaurant, dateRange, reportType);
  const transactionsData = createTransactionsSheet(transactions, ordersMap, includeOnlyVerified);
  
  // Combine header and transactions
  const sheet1Data = [...headerInfo, ...transactionsData];
  const ws1 = xlsx.utils.aoa_to_sheet(sheet1Data);
  xlsx.utils.book_append_sheet(wb, ws1, 'Transactions');

  // Sheet 2: Daily Summary
  const dailyData = createDailySummarySheet(transactions, includeOnlyVerified);
  const ws2 = xlsx.utils.aoa_to_sheet(dailyData);
  xlsx.utils.book_append_sheet(wb, ws2, 'Daily Summary');

  // Sheet 3: Items Breakdown
  const itemsData = createItemsBreakdownSheet(transactions, ordersMap, includeOnlyVerified);
  const ws3 = xlsx.utils.aoa_to_sheet(itemsData);
  xlsx.utils.book_append_sheet(wb, ws3, 'Items Breakdown');

  // Sheet 4: Payment Summary
  const paymentData = createPaymentSummarySheet(transactions, includeOnlyVerified);
  const ws4 = xlsx.utils.aoa_to_sheet(paymentData);
  xlsx.utils.book_append_sheet(wb, ws4, 'Payment Summary');

  // Generate buffer
  const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
  
  return buffer;
};

module.exports = {
  generateReport,
  formatCurrency,
  formatDateIST,
  formatDateTimeIST
};

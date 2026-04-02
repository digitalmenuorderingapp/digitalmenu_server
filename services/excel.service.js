const XLSX = require('xlsx');

exports.generateLedgerReport = async (ledgers, summary, monthName, year) => {
  const workbook = XLSX.utils.book_new();

  // 1. Daily Summaries Sheet
  const dailyData = ledgers.map(l => ({
    Date: new Date(l.date).toLocaleDateString(),
    'Total Orders': l.summary.totalOrders,
    'Served Orders': l.summary.servedOrders,
    'Total Revenue': l.summary.totalRevenue,
    'Cash Collected': l.summary.cashRevenue,
    'Cash Pending': l.summary.cashPendingRevenue,
    'Online Collected': l.summary.onlineRevenue,
    'Online Pending': l.summary.onlinePendingRevenue
  }));
  const dailySheet = XLSX.utils.json_to_sheet(dailyData);
  XLSX.utils.book_append_sheet(workbook, dailySheet, 'Daily Summaries');

  // 2. Monthly Totals Sheet
  const totalsData = [
    { Label: 'Month', Value: monthName },
    { Label: 'Year', Value: year },
    { Label: 'Total Orders', Value: summary.totalOrders },
    { Label: 'Served Orders', Value: summary.servedOrders },
    { Label: 'Total Revenue', Value: summary.totalRevenue },
    { Label: 'Cash Revenue', Value: summary.cashRevenue },
    { Label: 'Online Revenue', Value: summary.onlineRevenue },
    { Label: 'Online Verified', Value: summary.onlineVerifiedRevenue },
    { Label: 'Online Pending', Value: summary.onlinePendingRevenue }
  ];
  const totalsSheet = XLSX.utils.json_to_sheet(totalsData);
  XLSX.utils.book_append_sheet(workbook, totalsSheet, 'Monthly Totals');

  // 3. Top Selling Items Sheet
  const itemsData = summary.topItems.map((item, idx) => ({
    Rank: idx + 1,
    'Item Name': item.name,
    'Quantity Sold': item.count,
    'Total Revenue': item.totalRevenue
  }));
  const itemsSheet = XLSX.utils.json_to_sheet(itemsData);
  XLSX.utils.book_append_sheet(workbook, itemsSheet, 'Top Selling Items');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

exports.generateOrdersReport = async (orders, monthName, year) => {
  const workbook = XLSX.utils.book_new();

  const ordersData = orders.map(order => ({
    'Order No': order.orderNumber,
    'Date': new Date(order.createdAt).toLocaleDateString(),
    'Time': new Date(order.createdAt).toLocaleTimeString(),
    'Customer': order.customerName,
    'Method': order.paymentMethod,
    'Status': order.status,
    'Verified': order.paymentVerified ? 'Yes' : 'No',
    'Collected': order.cashCollected ? 'Yes' : 'No',
    'Amount': order.totalAmount,
    'Items': order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')
  }));

  const ordersSheet = XLSX.utils.json_to_sheet(ordersData);
  XLSX.utils.book_append_sheet(workbook, ordersSheet, 'All Orders');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

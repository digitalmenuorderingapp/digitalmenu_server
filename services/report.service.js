const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

/**
 * Format currency for Excel numbers
 * (Returns actual number for calculation but we apply currency formatting in ExcelJS)
 */
const formatCurrencyValue = (amount) => {
    if (amount === null || amount === undefined) return 0;
    return Number(amount);
};

/**
 * IST Helpers
 */
const formatDateIST = (date) => date ? moment(date).tz('Asia/Kolkata').format('YYYY-MM-DD') : '';
const formatTimeIST = (date) => date ? moment(date).tz('Asia/Kolkata').format('HH:mm:ss') : '';

/**
 * Apply Standard Zebra Striping & Borders
 */
const applyZebraStriping = (worksheet, startRow, endRow, endCol) => {
    for (let i = startRow; i <= endRow; i++) {
        const row = worksheet.getRow(i);
        if (i % 2 === 0) {
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                if (colNumber <= endCol) {
                    cell.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFF9FAFB' }
                    };
                }
            });
        }
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            if (colNumber <= endCol) {
                cell.border = {
                    top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
                    right: { style: 'thin', color: { argb: 'FFE5E7EB' } }
                };
            }
        });
    }
};

/**
 * Apply Status Highlights
 */
const applyStatusHighlights = (cell, value, type) => {
    if (!value) return;

    const val = String(value).toUpperCase();

    if (type === 'PAYMENT_STATUS') {
        if (val === 'VERIFIED') cell.font = { color: { argb: 'FF059669' }, bold: true }; // Green
        if (val === 'UNPAID') cell.font = { color: { argb: 'FFDC2626' }, bold: true };    // Red
        if (val === 'RETRY') cell.font = { color: { argb: 'FFD97706' }, bold: true };     // Orange
        if (val === 'PENDING') cell.font = { color: { argb: 'FF2563EB' }, bold: true };   // Blue
    }

    if (type === 'DUE_STATUS') {
        if (val === 'DUE') cell.font = { color: { argb: 'FFDC2626' }, bold: true };       // Red
        if (val === 'CLEAR') cell.font = { color: { argb: 'FF059669' }, bold: true };     // Green
    }

    if (type === 'ORDER_STATUS') {
        if (val === 'REJECTED' || val === 'CANCELLED') cell.font = { color: { argb: 'FFDC2626' }, bold: true };
        if (val === 'COMPLETED') cell.font = { color: { argb: 'FF059669' }, bold: true };
    }
};

/**
 * Create Menu Items sheet for full exports/deletion
 */
const createMenuItemsSheet = (workbook, menuItems) => {
    const sheet = workbook.addWorksheet('Menu Items');
    const headers = ['Name', 'Description', 'Category', 'Food Type', 'Price', 'Offer Price', 'Is Active', 'Created At'];
    
    const hRow = sheet.addRow(headers);
    hRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } }; // Amber for menu items
    hRow.alignment = { horizontal: 'center', vertical: 'middle' };

    menuItems.forEach((item) => {
        const row = sheet.addRow([
            item.name || 'N/A',
            item.description || '-',
            item.category || '-',
            (item.foodType || 'VEG').toUpperCase(),
            formatCurrencyValue(item.price),
            formatCurrencyValue(item.offerPrice) || '-',
            item.isActive ? 'Yes' : 'No',
            formatDateIST(item.createdAt)
        ]);
        
        row.getCell(5).numFmt = '₹#,##0.00';
        if (item.offerPrice) row.getCell(6).numFmt = '₹#,##0.00';
    });

    applyZebraStriping(sheet, 2, sheet.rowCount, headers.length);
    sheet.columns = headers.map(() => ({ width: 22 }));
};

/**
 * Main Report Generator
 */
const generateReport = async (restaurant, transactions, orders, options = {}) => {
    const { dateRange, includeOnlyVerified = true, menuItems } = options;
    const ordersMap = new Map();
    orders.forEach(o => ordersMap.set(o._id.toString(), o));

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DigitalMenu';
    workbook.lastModifiedBy = 'DigitalMenu';
    workbook.created = new Date();

    // --- TRANSACTION SHEET ---
    const txSheet = workbook.addWorksheet('Transactions', { views: [{ state: 'frozen', ySplit: 10 }] });
    
    // Sort transactions by date ASC
    const sortedTxs = [...transactions].sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));

    // Calculate High Level Statistics for Summary Block
    const stats = transactions.reduce((acc, tx) => {
        const amt = tx.amount || 0;
        const mode = (tx.paymentMode === 'CASH' || tx.paymentMode === 'COUNTER') ? 'CASH' : 'ONLINE';

        if (tx.type === 'REFUND') {
            acc.refunds += Math.abs(amt);
            if (mode === 'CASH') acc.cashRefunds += Math.abs(amt);
            if (mode === 'ONLINE') acc.onlineRefunds += Math.abs(amt);
        } else if (tx.status === 'VERIFIED') {
            acc.totalOrders++;
            acc.revenue += amt;
            if (mode === 'CASH') acc.cash += amt;
            if (mode === 'ONLINE') acc.online += amt;
        }
        return acc;
    }, { totalOrders: 0, revenue: 0, cash: 0, online: 0, refunds: 0, cashRefunds: 0, onlineRefunds: 0, dues: 0 });

    // Calculate Dues (From orders map)
    stats.dues = orders.reduce((sum, o) => o.paymentDueStatus === 'DUE' ? sum + (o.totalAmount || 0) : sum, 0);
    const netCash = stats.cash - stats.cashRefunds;
    const netOnline = stats.online - stats.onlineRefunds;
    const netRevenue = stats.revenue - stats.refunds;

    // Header Metadata & Summary Block
    txSheet.mergeCells('A1:D1');
    txSheet.getCell('A1').value = `DigitalMenu - Financial Report: ${restaurant.restaurantName}`;
    txSheet.getCell('A1').font = { bold: true, size: 14 };

    txSheet.getCell('A2').value = 'Date Range:';
    txSheet.getCell('B2').value = `${dateRange.from} to ${dateRange.to}`;
    txSheet.getCell('A3').value = 'Generated:';
    txSheet.getCell('B3').value = formatDateIST(new Date()) + ' ' + formatTimeIST(new Date());

    // Summary Box (Visual Box at top)
    const summaryLabels = ['Total Orders', 'Gross Cash', 'Cash Refunds', 'Cash In Hand', 'Gross Online', 'Online Refunds', 'Online Settled', 'Total Refund', 'Net Revenue', 'Pending Dues'];
    const summaryValues = [stats.totalOrders, stats.cash, stats.cashRefunds, netCash, stats.online, stats.onlineRefunds, netOnline, stats.refunds, netRevenue, stats.dues];
    
    summaryLabels.forEach((label, i) => {
        const row = txSheet.getRow(5);
        const cell = row.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true, size: 10, color: { argb: 'FF6B7280' } };
        cell.alignment = { horizontal: 'center' };

        const valCell = txSheet.getRow(6).getCell(i + 1);
        valCell.value = summaryValues[i];
        if (i > 0) valCell.numFmt = '₹#,##0.00';
        valCell.font = { bold: true, size: 12, color: { argb: 'FF111827' } };
        valCell.alignment = { horizontal: 'center' };
        
        // Coloring for Net Revenue and Dues
        if (label === 'Net Revenue') valCell.font.color = { argb: 'FF059669' };
        if (label === 'Pending Dues') valCell.font.color = { argb: 'FFDC2626' };
    });

    // Transactions Table Headers
    const txHeaders = [
        'Date', 'Time', 'Order No', 'Table No', 'Customer Name', 'Persons', 
        'Items', 'Qty', 'Order Type', 'Payment Mode', 'Collected Via', 
        'Payment Status', 'Order Status', 'Amount', 'Online Amount', 
        'Cash Amount', 'Refund Amount', 'Running Balance', 'Payment Due Status', 
        'Retry Count', 'Rejection Reason'
    ];
    
    const headerRow = txSheet.getRow(9);
    txHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Populate Transactions
    let currentBalance = 0;
    sortedTxs.forEach((tx, idx) => {
        const order = ordersMap.get(tx.orderId?.toString()) || {};
        const isRefund = tx.type === 'REFUND';
        const amt = tx.amount || 0;
        
        const refundAmt = isRefund ? Math.abs(amt) : 0;
        const onlineAmt = (!isRefund && tx.paymentMode === 'ONLINE') ? amt : 0;
        const cashAmt = (!isRefund && tx.paymentMode === 'CASH') ? amt : 0;
        
        currentBalance += amt;

        const rowData = [
            formatDateIST(tx.transactionDate),
            formatTimeIST(tx.transactionDate),
            order.orderNumber || tx.meta?.orderNumber || 'N/A',
            order.tableNumber || tx.meta?.tableNumber || '-',
            order.customerName || 'Walk-in',
            order.numberOfPersons || 1,
            (order.items || []).map(i => `${i.name} x${i.quantity}`).join('\n'),
            (order.items || []).reduce((s, i) => s + (i.quantity || 0), 0),
            (order.orderType || 'DINE-IN').toUpperCase(),
            tx.paymentMode || 'N/A',
            order.collectedVia || 'N/A',
            tx.status || order.paymentStatus || 'PENDING',
            order.status || 'N/A',
            isRefund ? 0 : amt, // Don't show refund in main amount as per requirement rules
            onlineAmt,
            cashAmt,
            refundAmt,
            currentBalance,
            order.paymentDueStatus || 'CLEAR',
            order.retryCount || 0,
            order.rejectionReason || ''
        ];

        const row = txSheet.addRow(rowData);
        
        // Styling data cells
        row.getCell(7).alignment = { wrapText: true };
        row.getCell(14).numFmt = '₹#,##0.00';
        row.getCell(15).numFmt = '₹#,##0.00';
        row.getCell(16).numFmt = '₹#,##0.00';
        row.getCell(17).numFmt = '₹#,##0.00';
        row.getCell(18).numFmt = '₹#,##0.00';

        // Conditional Formatting
        if (isRefund) {
            row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            });
        }
        
        applyStatusHighlights(row.getCell(12), rowData[11], 'PAYMENT_STATUS');
        applyStatusHighlights(row.getCell(13), rowData[12], 'ORDER_STATUS');
        applyStatusHighlights(row.getCell(19), rowData[18], 'DUE_STATUS');
    });

    applyZebraStriping(txSheet, 10, txSheet.rowCount, txHeaders.length);
    txSheet.columns = txHeaders.map(() => ({ width: 18 }));

    // --- ITEMS BREAKDOWN SHEET ---
    const itemSheet = workbook.addWorksheet('Items Breakdown');
    const itemHeaders = ['Date', 'Time', 'Order No', 'Table No', 'Item Name', 'Quantity', 'Price', 'Total'];
    const iHeaderRow = itemSheet.addRow(itemHeaders);
    iHeaderRow.font = { bold: true };
    iHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    iHeaderRow.alignment = { horizontal: 'center' };

    let totalItemQty = 0;
    let totalItemSales = 0;

    // Filter relevant orders for breakdown
    const breakdownOrders = orders.filter(o => o.status === 'COMPLETED' || o.paymentStatus === 'VERIFIED');
    breakdownOrders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    breakdownOrders.forEach(o => {
        (o.items || []).forEach(item => {
            const lineTotal = item.price * item.quantity;
            totalItemQty += item.quantity;
            totalItemSales += lineTotal;
            
            const r = itemSheet.addRow([
                formatDateIST(o.createdAt),
                formatTimeIST(o.createdAt),
                o.orderNumber,
                o.tableNumber || '-',
                item.name,
                item.quantity,
                item.price,
                lineTotal
            ]);
            r.getCell(7).numFmt = '₹#,##0.00';
            r.getCell(8).numFmt = '₹#,##0.00';
        });
    });

    // Items Summary Footer
    itemSheet.addRow([]);
    const itemFooter = itemSheet.addRow(['', '', '', '', 'TOTAL SUMMARY', totalItemQty, '', totalItemSales]);
    itemFooter.font = { bold: true };
    itemFooter.getCell(8).numFmt = '₹#,##0.00';
    
    itemSheet.columns = itemHeaders.map(() => ({ width: 18 }));
    applyZebraStriping(itemSheet, 2, itemSheet.rowCount - 1, itemHeaders.length);

    // --- DAILY SUMMARY SHEET ---
    const dailySheet = workbook.addWorksheet('Daily Summary');
    const dayHeaders = ['Date', 'Orders', 'Gross Cash', 'Cash Refund', 'Gross Online', 'Online Refund', 'Net Balance'];
    const dHeaderRow = dailySheet.addRow(dayHeaders);
    dHeaderRow.font = { bold: true };
    dHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    
    // Group by Date
    const dailyData = sortedTxs.reduce((acc, tx) => {
        const d = formatDateIST(tx.transactionDate);
        if (!acc[d]) acc[d] = { orders: new Set(), online: 0, cash: 0, refund: 0, cashRefund: 0, onlineRefund: 0 };
        const mode = (tx.paymentMode === 'CASH' || tx.paymentMode === 'COUNTER') ? 'CASH' : 'ONLINE';
        
        if (tx.type === 'REFUND') {
            acc[d].refund += Math.abs(tx.amount || 0);
            if (mode === 'CASH') acc[d].cashRefund += Math.abs(tx.amount);
            if (mode === 'ONLINE') acc[d].onlineRefund += Math.abs(tx.amount);
        } else if (tx.status === 'VERIFIED') {
            acc[d].orders.add(tx.orderId?.toString());
            if (mode === 'CASH') acc[d].cash += tx.amount;
            if (mode === 'ONLINE') acc[d].online += tx.amount;
        }
        return acc;
    }, {});

    Object.entries(dailyData).sort().forEach(([date, d]) => {
        const r = dailySheet.addRow([
            date,
            d.orders.size,
            d.cash,
            d.cashRefund,
            d.online,
            d.onlineRefund,
            (d.cash + d.online) - (d.cashRefund + d.onlineRefund)
        ]);
        [3, 4, 5, 6, 7].forEach(c => r.getCell(c).numFmt = '₹#,##0.00');
    });
    
    dailySheet.columns = dayHeaders.map(() => ({ width: 18 }));
    applyZebraStriping(dailySheet, 2, dailySheet.rowCount, dayHeaders.length);

    // --- PAYMENT SUMMARY SHEET ---
    const paySheet = workbook.addWorksheet('Payment Summary');
    
    // A. Payment Status Summary
    paySheet.addRow(['A. PAYMENT STATUS SUMMARY']).font = { bold: true, size: 12 };
    paySheet.addRow(['Status', 'Count', 'Amount']).font = { bold: true };
    
    const paySum = orders.reduce((acc, o) => {
        const s = o.paymentStatus || 'PENDING';
        if (!acc[s]) acc[s] = { count: 0, amount: 0 };
        acc[s].count++;
        acc[s].amount += (o.totalAmount || 0);
        return acc;
    }, {});

    ['VERIFIED', 'PENDING', 'RETRY', 'UNPAID'].forEach(s => {
        const data = paySum[s] || { count: 0, amount: 0 };
        const r = paySheet.addRow([s, data.count, data.amount]);
        r.getCell(3).numFmt = '₹#,##0.00';
        if (s === 'VERIFIED') r.getCell(1).font = { color: { argb: 'FF059669' }, bold: true };
        if (s === 'UNPAID') r.getCell(1).font = { color: { argb: 'FFDC2626' }, bold: true };
    });

    // B. Cash Flow
    paySheet.addRow([]);
    paySheet.addRow(['B. CASH FLOW (NET)']).font = { bold: true, size: 12 };
    paySheet.addRow(['Type', 'Amount']).font = { bold: true };
    paySheet.addRow(['Cash Collected (Gross)', stats.cash]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Cash Refunded', stats.cashRefunds]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Cash In Hand (Net)', netCash]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow([]);
    paySheet.addRow(['Online Collected (Gross)', stats.online]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Online Refunded', stats.onlineRefunds]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Online Settled (Net)', netOnline]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow([]);
    paySheet.addRow(['Total Gross Revenue', stats.revenue]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Total Refund Amount', stats.refunds]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Total Net Revenue', netRevenue]).getCell(2).numFmt = '₹#,##0.00';

    // C. Dues
    paySheet.addRow([]);
    paySheet.addRow(['C. PENDING DUES']).font = { bold: true, size: 12 };
    paySheet.addRow(['Description', 'Amount']).font = { bold: true };
    const dueRow = paySheet.addRow(['Served Orders but Unpaid', stats.dues]);
    dueRow.getCell(2).numFmt = '₹#,##0.00';
    dueRow.getCell(2).font = { color: { argb: 'FFDC2626' }, bold: true };

    paySheet.columns = [{ width: 30 }, { width: 20 }, { width: 20 }];

    // --- MENU ITEMS SHEET (Optional) ---
    if (menuItems && Array.isArray(menuItems) && menuItems.length > 0) {
        createMenuItemsSheet(workbook, menuItems);
    }

    // --- Finalize Buffer ---
    return await workbook.xlsx.writeBuffer();
};

module.exports = {
    generateReport,
    formatCurrency: (amt) => `₹${Number(amt).toFixed(2)}`,
    formatDateIST,
    formatDateTimeIST: (d) => d ? `${formatDateIST(d)} ${formatTimeIST(d)}` : ''
};

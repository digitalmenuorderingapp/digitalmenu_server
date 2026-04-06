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
    const txSheet = workbook.addWorksheet('Transactions');
    
    // Calculate High Level Statistics for Summary Block
    const verifiedOrderIds = new Set(
        transactions.filter(t => t.type === 'PAYMENT' && t.status === 'VERIFIED')
                   .map(t => t.orderId?.toString())
    );


    // --- New Financial Model ---
    const stats = {
        totalOrders: 0,
        revenue: 0,       // Accrual: Earned from served orders
        cash: 0,          // Gross Cash Collected
        online: 0,        // Gross Online Collected
        refunds: 0,       // Total Refunds
        cashRefunds: 0,
        onlineRefunds: 0,
        dues: 0           // Served but not Paid
    };

    // 1. Calculate Accrual Summary (Revenue) from Orders
    orders.forEach(o => {
        if (o.status === 'COMPLETED') {
            stats.totalOrders++;
            stats.revenue += (o.totalAmount || 0);
            if (o.paymentStatus === 'UNPAID') {
                stats.dues += (o.totalAmount || 0);
            }
        }
    });

    // 2. Calculate Liquidity Summary (Cash/Online) from Transactions
    transactions.forEach(tx => {
        const isRefund = tx.type === 'REFUND';
        const isVerifiedTx = tx.status === 'VERIFIED';
        const amt = tx.amount || 0;
        const mode = (tx.paymentMode === 'CASH' || tx.paymentMode === 'COUNTER') ? 'CASH' : 'ONLINE';

        if (isRefund) {
            stats.refunds += Math.abs(amt);
            if (mode === 'CASH') stats.cashRefunds += Math.abs(amt);
            if (mode === 'ONLINE') stats.onlineRefunds += Math.abs(amt);
        } else if (isVerifiedTx) {
            // Money entered the bank, regardless of whether the order was served.
            // If it was cancelled later, the Refund row will subtract it.
            if (mode === 'CASH') stats.cash += amt;
            if (mode === 'ONLINE') stats.online += amt;
        }
    });

    // --- CONSOLIDATED ROW GENERATION FOR LEDGER ---
    // We want the ledger to show BOTH money movement (Transactions) 
    // AND accrual events (Unpaid Completed Orders) to ensure Auditability.
    const ledgerRows = transactions.map(tx => ({
        type: 'TX',
        date: tx.transactionDate,
        tx: tx,
        order: ordersMap.get(tx.orderId?.toString()) || {}
    }));

    // Add phantom rows for Completed Unpaid orders (to track revenue without transaction)
    const orderIdsWithVerifiedTxs = new Set(
        transactions.filter(t => t.status === 'VERIFIED').map(t => t.orderId?.toString())
    );

    orders.forEach(o => {
        if (o.status === 'COMPLETED' && !orderIdsWithVerifiedTxs.has(o._id.toString())) {
            ledgerRows.push({
                type: 'ACCRUAL',
                date: o.createdAt,
                tx: {
                    transactionDate: o.createdAt,
                    amount: o.totalAmount,
                    status: 'UNPAID',
                    paymentMode: 'N/A',
                    type: 'SERVICE'
                },
                order: o
            });
        }
    });

    const sortedRows = ledgerRows.sort((a, b) => new Date(a.date) - new Date(b.date));

    // Calculate Settlement Stats for Summary Row
    const cashInHand = stats.cash - stats.cashRefunds;
    const onlineSettled = stats.online - stats.onlineRefunds;
    const totalNetBalance = cashInHand + onlineSettled;

    // Header Metadata & Summary Block
    txSheet.mergeCells('A1:D1');
    txSheet.getCell('A1').value = `DigitalMenu - Financial Report: ${restaurant.restaurantName}`;
    txSheet.getCell('A1').font = { bold: true, size: 14 };

    txSheet.getCell('A2').value = 'Date Range:';
    txSheet.getCell('B2').value = `${dateRange.from} to ${dateRange.to}`;
    txSheet.getCell('A3').value = 'Generated:';
    txSheet.getCell('B3').value = formatDateIST(new Date()) + ' ' + formatTimeIST(new Date());

    // Detailed Counts
    const servedCount = orders.filter(o => o.status === 'COMPLETED').length;
    const cancelledCount = orders.filter(o => o.status === 'CANCELLED').length;
    const rejectedCount = orders.filter(o => o.status === 'REJECTED').length;
    const unpaidCount = orders.filter(o => o.paymentStatus === 'UNPAID').length;
    const pendingPaymentCount = orders.filter(o => o.paymentStatus === 'PENDING').length;

    // Summary Box (Visual Box at top) - Refined for Accrual vs Liquidity 
    const summaryLabels = [
        'Gross Cash', 'Cash Refunded', 'Cash in Hand', 
        'Gross Online', 'Online Refunded', 'Settled Online', 
        'Unpaid (Served)', 'Settled Balance', 'Today Revenue'
    ];
    const summaryValues = [
        stats.cash, stats.cashRefunds, cashInHand,
        stats.online, stats.onlineRefunds, onlineSettled,
        stats.dues, totalNetBalance, stats.revenue
    ];
    
    summaryLabels.forEach((label, i) => {
        const row = txSheet.getRow(5);
        const cell = row.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
        cell.alignment = { horizontal: 'center' };

        const valCell = txSheet.getRow(6).getCell(i + 1);
        valCell.value = summaryValues[i];
        
        // Formatting: All are currency except index 8? No, all are currency here.
        valCell.numFmt = '₹#,##0.00';
        
        valCell.font = { bold: true, size: 11, color: { argb: 'FF111827' } };
        valCell.alignment = { horizontal: 'center' };
        
        // Highlight critical metrics
        if (label === 'Settled Balance') valCell.font.color = { argb: 'FF059669' }; // Green
        if (label === 'Today Revenue') valCell.font.color = { argb: 'FF4F46E5' };   // Indigo
        if (label === 'Unpaid (Served)') valCell.font.color = { argb: 'FFDC2626' }; // Red
    });

    // Operational Metrics Section (Secondary Summary for Counts)
    const metricLabels = ['Served Orders', 'Cancelled Orders', 'Rejected Orders', 'Unpaid (Served)', 'Pending Payment'];
    const metricValues = [servedCount, cancelledCount, rejectedCount, unpaidCount, pendingPaymentCount];

    metricLabels.forEach((label, i) => {
        const row = txSheet.getRow(8);
        const cell = row.getCell(i + 1);
        cell.value = label;
        cell.font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
        cell.alignment = { horizontal: 'center' };

        const valCell = txSheet.getRow(9).getCell(i + 1);
        valCell.value = metricValues[i];
        valCell.font = { bold: true, size: 11, color: { argb: 'FF374151' } };
        valCell.alignment = { horizontal: 'center' };
        
        if (label === 'Unpaid (Served)') valCell.font.color = { argb: 'FFDC2626' }; // Red for unpaid
    });

    // Transactions Table Headers (Shifted down to row 12)
    const txHeaders = [
        'Date', 'Time', 'Order No', 'Table No', 'Customer Name', 'Persons', 
        'Items', 'Qty', 'Order Type', 'Payment Mode', 'Collected Via', 
        'Payment Status', 'Order Status', 'Order Value', 'Online Amount', 
        'Cash Amount', 'Refund Amount', 'Settled Amount', 'Settled Balance', 
        'Revenue', 'Unpaid Amount', 
        'Rejection Reason', 'Cancel Reason', 'Unpaid Reason', 'Feedback', 'Rating'
    ];
    
    const headerRow = txSheet.getRow(12);
    txHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    // Populate Transactions
    let currentBalance = 0;
    let currentSettledBalance = 0;
    sortedRows.forEach((rowObj, idx) => {
        const { tx, order, type } = rowObj;
        const isRefund = tx.type === 'REFUND';
        const isVerifiedTx = tx.status === 'VERIFIED';
        const isServed = order.status === 'COMPLETED';
        const isRejected = order.status === 'REJECTED' || order.status === 'CANCELLED';
        
        const amt = tx.amount || 0;
        const orderValue = order.totalAmount || (isRefund ? 0 : amt);
        
        const refundAmt = isRefund ? Math.abs(amt) : 0;
        const onlineAmt = (!isRefund && tx.paymentMode === 'ONLINE') ? amt : 0;
        const cashAmt = (!isRefund && (tx.paymentMode === 'CASH' || tx.paymentMode === 'COUNTER')) ? amt : 0;
        
        // Revenue Definition: Any served item counts as revenue (Accrual)
        // We only count it ONCE per order. This logic matches our Summary Stats.
        let revenue = 0;
        if (isServed && !isRefund && !isRejected) {
             // In our consolidated Row List, revenue is assigned to:
             // 1. The ACCRUAL row (if order is unpaid)
             // 2. The first TX row (if order is paid)
             // Wait, let's keep it simpler: any row that is NOT a refund and is completed?
             // No, that doubles it if there's multiple TX.
             // Simplest: only for type 'ACCRUAL' or if it's the main payment.
             // But let's use the 'isAccrualEvent' logic.
             const isFirstVerified = (idx === sortedRows.findIndex(r => r.order?._id?.toString() === order._id?.toString() && r.tx?.status === 'VERIFIED'));
             const isAccrualRow = (type === 'ACCRUAL');
             
             if (isAccrualRow || isFirstVerified) {
                 revenue = orderValue || amt;
             }
        }

        currentBalance += revenue;

        // Settled Logic: Verified Payment (positive) OR Refund (negative)
        let settledAmt = 0;
        if (isVerifiedTx) {
            settledAmt = isRefund ? -Math.abs(amt) : amt;
        }
        currentSettledBalance += settledAmt;

        // Extract reasons and feedback
        const unpaidEntry = (order.statusHistory || []).slice().reverse().find(h => h.paymentStatus === 'UNPAID');
        const unpaidReason = order.unpaidReason || (unpaidEntry ? unpaidEntry.reason : '');
        const feedbackComment = order.feedback?.comment || '';

        const rowData = [
            formatDateIST(tx.transactionDate),
            formatTimeIST(tx.transactionDate),
            order.orderNumber || tx.meta?.orderNumber || 'N/A',
            order.tableNumber || tx.meta?.tableNumber || '-',
            order.customerName || 'Walk-in',
            order.numberOfPersons || 1,
            (order.items || []).map(i => `${i.name} x${i.quantity}`).join('\n'),
            (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0),
            (order.orderType || 'DINE-IN').toUpperCase(),
            tx.paymentMode || 'N/A',
            order.collectedVia || 'N/A',
            tx.status || order.paymentStatus || 'PENDING',
            order.status || 'N/A',
            orderValue,
            onlineAmt,
            cashAmt,
            refundAmt,
            settledAmt,
            currentSettledBalance,
            revenue,
            (revenue > 0 && !isVerifiedTx) ? revenue : 0, // Unpaid Amount for this row
            order.rejectionReason || '',
            order.cancellationReason || '',
            unpaidReason,
            feedbackComment,
            order.feedback?.rating || '-'
        ];

        const row = txSheet.addRow(rowData);
        
        // Styling data cells
        row.getCell(7).alignment = { wrapText: true };
        row.getCell(25).alignment = { wrapText: true }; 
        row.getCell(26).alignment = { horizontal: 'center' };
        [14, 15, 16, 17, 18, 19, 20, 21].forEach(colIndex => {
            row.getCell(colIndex).numFmt = '₹#,##0.00';
        });

        // Highlights
        if (isRefund) {
            row.eachCell(cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            });
        }
        if (type === 'ACCRUAL') {
             row.getCell(12).font = { color: { argb: 'FFDC2626' }, bold: true }; // Red for Unpaid Accrual
        }
        
        applyStatusHighlights(row.getCell(12), rowData[11], 'PAYMENT_STATUS');
        applyStatusHighlights(row.getCell(13), rowData[12], 'ORDER_STATUS');
    });

    applyZebraStriping(txSheet, 13, txSheet.rowCount, txHeaders.length);
    txSheet.columns = txHeaders.map(() => ({ width: 18 }));

    // --- ITEMS BREAKDOWN SHEET ---
    const itemSheet = workbook.addWorksheet('Items Breakdown');
    const itemHeaders = ['Date', 'Item Name', 'Orders', 'Quantity', 'Price', 'Amount'];
    const iHeaderRow = itemSheet.addRow(itemHeaders);
    iHeaderRow.font = { bold: true };
    iHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
    iHeaderRow.alignment = { horizontal: 'center' };

    // Aggregate items by Date and Name
    const itemAggregation = {};
    const breakdownOrders = orders.filter(o => o.status === 'COMPLETED' || o.paymentStatus === 'VERIFIED');
    breakdownOrders.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    breakdownOrders.forEach(o => {
        const dateStr = formatDateIST(o.createdAt);
        (o.items || []).forEach(item => {
            const key = `${dateStr}_${item.name}`;
            if (!itemAggregation[key]) {
                itemAggregation[key] = {
                    date: dateStr,
                    name: item.name,
                    orders: new Set(),
                    quantity: 0,
                    price: item.price
                };
            }
            itemAggregation[key].orders.add(o.orderNumber || '#N/A');
            itemAggregation[key].quantity += (item.quantity || 0);
        });
    });

    let totalItemQty = 0;
    let totalItemSales = 0;

    Object.values(itemAggregation).forEach(ag => {
        const amount = ag.price * ag.quantity;
        totalItemQty += ag.quantity;
        totalItemSales += amount;

        const r = itemSheet.addRow([
            ag.date,
            ag.name,
            Array.from(ag.orders).join(', '),
            ag.quantity,
            ag.price,
            amount
        ]);
        r.getCell(3).alignment = { wrapText: true };
        r.getCell(5).numFmt = '₹#,##0.00';
        r.getCell(6).numFmt = '₹#,##0.00';
    });

    // Items Summary Footer
    itemSheet.addRow([]);
    const itemFooter = itemSheet.addRow(['', 'TOTAL SUMMARY', '', totalItemQty, '', totalItemSales]);
    itemFooter.font = { bold: true };
    itemFooter.getCell(6).numFmt = '₹#,##0.00';
    
    itemSheet.columns = itemHeaders.map(() => ({ width: 22 }));
    itemSheet.getColumn(3).width = 40; // Orders column wide for many numbers
    applyZebraStriping(itemSheet, 2, itemSheet.rowCount - 1, itemHeaders.length);

    // --- DAILY SUMMARY SHEET ---
    const dailySheet = workbook.addWorksheet('Daily Summary');
    const dayHeaders = ['Date', 'Orders', 'Gross Cash', 'Cash Refund', 'Gross Online', 'Online Refund', 'Net Balance'];
    const dHeaderRow = dailySheet.addRow(dayHeaders);
    dHeaderRow.font = { bold: true };
    dHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    
    // Group by Date (Using raw transactions as they represent money flow events)
    const sortedDailyTxs = [...transactions].sort((a, b) => new Date(a.transactionDate) - new Date(b.transactionDate));
    const dailyData = sortedDailyTxs.reduce((acc, tx) => {
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
    
    // Freeze headers for better usability
    txSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 12 }];
    itemSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
    dailySheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];

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

    ['VERIFIED', 'PENDING', 'UNPAID'].forEach(s => {
        const data = paySum[s] || { count: 0, amount: 0 };
        const r = paySheet.addRow([s, data.count, data.amount]);
        r.getCell(3).numFmt = '₹#,##0.00';
        if (s === 'VERIFIED') r.getCell(1).font = { color: { argb: 'FF059669' }, bold: true };
        if (s === 'UNPAID') r.getCell(1).font = { color: { argb: 'FFDC2626' }, bold: true };
    });

    // B. Cash Flow (Settlement)
    paySheet.addRow([]);
    paySheet.addRow(['B. LIQUIDITY & SETTLEMENT']).font = { bold: true, size: 12 };
    paySheet.addRow(['Type', 'Amount']).font = { bold: true };
    paySheet.addRow(['Cash Collected (Gross)', stats.cash]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Cash Refunded', stats.cashRefunds]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Cash in Hand (Net)', cashInHand]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow([]);
    paySheet.addRow(['Online Collected (Gross)', stats.online]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Online Refunded', stats.onlineRefunds]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Online Settled (Net)', onlineSettled]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow([]);
    paySheet.addRow(['Settled Balance (Liquidity)', totalNetBalance]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Unpaid Amount (Served)', stats.dues]).getCell(2).numFmt = '₹#,##0.00';
    paySheet.addRow(['Total Revenue (Accrual)', stats.revenue]).getCell(2).numFmt = '₹#,##0.00';

    // C. Dues
    paySheet.addRow([]);
    paySheet.addRow(['C. PENDING DUES (REVENUE LOSS)']).font = { bold: true, size: 12 };
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

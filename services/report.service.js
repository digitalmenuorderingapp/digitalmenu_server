const ExcelJS = require('exceljs');
const moment = require('moment-timezone');

/**
 * Format currency for Excel numbers
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
    hRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } };
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
 * Main Report Generator (Now centered around Orders)
 */
const generateReport = async (restaurant, orders, options = {}) => {
    const { dateRange, includeOnlyVerified = true, menuItems } = options;

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'DigitalMenu';
    workbook.lastModifiedBy = 'DigitalMenu';
    workbook.created = new Date();

    // --- TRANSACTION SHEET ---
    const txSheet = workbook.addWorksheet('Transactions');
    
    // Financial Model Summary
    const stats = {
        totalOrders: 0,
        revenue: 0,       // Earned from served orders
        cash: 0,          // Verified Cash
        online: 0,        // Verified Online
        dues: 0           // Served but UNPAID
    };

    orders.forEach(o => {
        const isRejected = ['REJECTED', 'CANCELLED'].includes(o.status);
        const isVerified = o.paymentStatus === 'VERIFIED';
        const isServed = o.status === 'COMPLETED';
        const isDue = o.paymentStatus === 'UNPAID';
        const amt = o.totalAmount || 0;

        if (isServed && !isRejected) {
            stats.totalOrders++;
            stats.revenue += amt;
            if (isDue) stats.dues += amt;
        }

        if (isVerified && !isRejected) {
            if (o.collectedVia === 'CASH') stats.cash += amt;
            else if (o.collectedVia === 'ONLINE') stats.online += amt;
        }
    });

    // Header Metadata
    txSheet.mergeCells('A1:D1');
    txSheet.getCell('A1').value = `DigitalMenu - Financial Report: ${restaurant.restaurantName}`;
    txSheet.getCell('A1').font = { bold: true, size: 14 };

    txSheet.getCell('A2').value = 'Date Range:';
    txSheet.getCell('B2').value = `${dateRange.from} to ${dateRange.to}`;
    txSheet.getCell('A3').value = 'Generated:';
    txSheet.getCell('B3').value = formatDateIST(new Date()) + ' ' + formatTimeIST(new Date());

    // Summary Box
    const summaryLabels = ['Total Cash', 'Total Online', 'Total Revenue', 'Unpaid (Served)'];
    const summaryValues = [stats.cash, stats.online, stats.revenue, stats.dues];
    
    summaryLabels.forEach((label, i) => {
        txSheet.getRow(5).getCell(i + 1).value = label;
        txSheet.getRow(5).getCell(i + 1).font = { bold: true, size: 9, color: { argb: 'FF6B7280' } };
        txSheet.getRow(5).getCell(i + 1).alignment = { horizontal: 'center', vertical: 'middle' };

        const valCell = txSheet.getRow(6).getCell(i + 1);
        valCell.value = summaryValues[i];
        valCell.numFmt = '₹#,##0.00';
        valCell.font = { bold: true, size: 11, color: { argb: 'FF111827' } };
        valCell.alignment = { horizontal: 'center', vertical: 'middle' };
        
        if (label === 'Total Revenue') valCell.font.color = { argb: 'FF059669' };
        if (label === 'Unpaid (Served)') valCell.font.color = { argb: 'FFDC2626' };
    });

    // Transactions Table Headers (row 12)
    const txHeaders = [
        'Date', 'Time', 'Order No', 'Table No', 'Customer Name', 'Persons', 
        'Items', 'Qty', 'Order Type', 'Collected Via', 
        'Payment Status', 'Order Status', 'Order Value', 'Online Amount', 
        'Cash Amount', 'Revenue', 'Running Balance', 'Unpaid Amount', 
        'Rejection Reason', 'Cancel Reason', 'Unpaid Reason', 'Feedback', 'Rating',
        'Collected at'
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
    let currentSettledBalance = 0;
    orders.forEach((order) => {
        const isVerified = order.paymentStatus === 'VERIFIED';
        const isServed = order.status === 'COMPLETED';
        const isRejected = ['REJECTED', 'CANCELLED'].includes(order.status);
        const orderValue = order.totalAmount || 0;
        
        const onlineAmt = (isVerified && order.collectedVia === 'ONLINE') ? orderValue : 0;
        const cashAmt = (isVerified && order.collectedVia === 'CASH') ? orderValue : 0;
        const settledAmt = isVerified ? orderValue : 0;
        currentSettledBalance += settledAmt;

        let revenue = (isServed && !isRejected) ? orderValue : 0;

        // Determine collected at date/time
        const collectedAt = isVerified ? (order.collectedAt || order.updatedAt || order.createdAt) : null;
        const collectedAtStr = collectedAt ? `${formatDateIST(collectedAt)} ${formatTimeIST(collectedAt)}` : '-';
        
        // Check if more than 1 day old
        const now = moment().tz('Asia/Kolkata');
        const collectedMoment = collectedAt ? moment(collectedAt).tz('Asia/Kolkata') : null;
        const isMoreThanOneDay = collectedMoment ? now.diff(collectedMoment, 'days') >= 1 : false;

        const rowData = [
            formatDateIST(order.createdAt),
            formatTimeIST(order.createdAt),
            order.orderNumber || 'N/A',
            order.tableNumber || '-',
            order.customerName || 'Walk-in',
            order.numberOfPersons || 1,
            (order.items || []).map(i => `${i.name} x${i.quantity}`).join('\n'),
            (order.items || []).reduce((sum, item) => sum + (item.quantity || 0), 0),
            order.orderType || 'DINE-IN',
            order.collectedVia || 'N/A',
            order.paymentStatus || 'PENDING',
            order.status || 'N/A',
            orderValue,
            onlineAmt,
            cashAmt,
            revenue,
            currentSettledBalance,
            (revenue > 0 && !isVerified) ? revenue : 0,
            order.rejectionReason || '',
            order.cancellationReason || '',
            order.unpaidReason || '',
            order.feedback?.comment || '',
            order.feedback?.rating || '-',
            collectedAtStr
        ];

        const row = txSheet.addRow(rowData);
        row.getCell(7).alignment = { wrapText: true };
        row.getCell(24).alignment = { wrapText: true }; 
        [13, 14, 15, 16, 17, 18].forEach(colIndex => {
            row.getCell(colIndex).numFmt = '₹#,##0.00';
        });

        applyStatusHighlights(row.getCell(11), rowData[10], 'PAYMENT_STATUS');
        applyStatusHighlights(row.getCell(12), rowData[11], 'ORDER_STATUS');
        
        // Apply conditional formatting to 'Collected at' column (column 24)
        const collectedAtCell = row.getCell(24);
        const orderStatus = String(order.status).toUpperCase();
        const paymentStatus = String(order.paymentStatus).toUpperCase();
        
        if (isMoreThanOneDay && isVerified) {
            // More than 1 day - Red background
            collectedAtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            collectedAtCell.font = { color: { argb: 'FFDC2626' }, bold: true };
        } else if (paymentStatus === 'UNPAID') {
            // Unpaid - Red background
            collectedAtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
            collectedAtCell.font = { color: { argb: 'FFDC2626' }, bold: true };
        } else if (orderStatus === 'REJECTED') {
            // Rejected - Light grey background
            collectedAtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } };
            collectedAtCell.font = { color: { argb: 'FF6B7280' } };
        } else if (orderStatus === 'CANCELLED') {
            // Cancelled - Light yellow background
            collectedAtCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
            collectedAtCell.font = { color: { argb: 'FFD97706' } };
        }
    });

    applyZebraStriping(txSheet, 13, txSheet.rowCount, txHeaders.length);
    txSheet.columns = txHeaders.map(() => ({ width: 18 }));
    txSheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 12 }];

    // --- Daily Summary Sheet ---
    const dailySheet = workbook.addWorksheet('Daily Summary');
    const dayHeaders = ['Date', 'Orders', 'Gross Cash', 'Gross Online', 'Net Balance'];
    const dHeaderRow = dailySheet.addRow(dayHeaders);
    dHeaderRow.font = { bold: true };
    dHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
    
    const dailyData = orders.reduce((acc, o) => {
        const d = formatDateIST(o.createdAt);
        if (!acc[d]) acc[d] = { count: 0, cash: 0, online: 0 };
        if (o.paymentStatus === 'VERIFIED') {
            acc[d].count++;
            if (o.collectedVia === 'CASH') acc[d].cash += (o.totalAmount || 0);
            else if (o.collectedVia === 'ONLINE') acc[d].online += (o.totalAmount || 0);
        }
        return acc;
    }, {});

    Object.entries(dailyData).sort().forEach(([date, d]) => {
        const r = dailySheet.addRow([date, d.count, d.cash, d.online, (d.cash + d.online)]);
        [3, 4, 5].forEach(c => {
            r.getCell(c).numFmt = '₹#,##0.00';
            r.getCell(c).alignment = { horizontal: 'center', vertical: 'middle' };
        });
        
        // Center align all cells in the row
        r.eachCell({ includeEmpty: true }, (cell) => {
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
    });
    dailySheet.columns = dayHeaders.map(() => ({ width: 18 }));
    applyZebraStriping(dailySheet, 2, dailySheet.rowCount, dayHeaders.length);

    // --- Items Breakdown Sheet ---
    const itemsSheet = workbook.addWorksheet('Items Breakdown');
    const itemsHeaders = ['Date', 'Item Name', 'Orders Count', 'Quantity', 'Price', 'Total'];
    const itemsHeaderRow = itemsSheet.addRow(itemsHeaders);
    itemsHeaderRow.font = { bold: true };
    itemsHeaderRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF59E0B' } }; // Amber
    
    // Aggregate items data
    const itemsData = orders.reduce((acc, order) => {
        const date = formatDateIST(order.createdAt);
        const orderItems = order.items || [];
        
        orderItems.forEach(item => {
            const key = `${date}-${item.name}`;
            if (!acc[key]) {
                acc[key] = {
                    date,
                    itemName: item.name,
                    ordersCount: 0,
                    quantity: 0,
                    price: item.price || 0
                };
            }
            acc[key].ordersCount += 1;
            acc[key].quantity += item.quantity || 0;
        });
        return acc;
    }, {});

    // Sort by date then item name
    Object.values(itemsData)
        .sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.itemName.localeCompare(b.itemName);
        })
        .forEach(item => {
            const total = item.quantity * item.price;
            const r = itemsSheet.addRow([
                item.date,
                item.itemName,
                item.ordersCount,
                item.quantity,
                item.price,
                total
            ]);
            [5, 6].forEach(c => r.getCell(c).numFmt = '₹#,##0.00'); // Price and Total
        });

    itemsSheet.columns = [
        { width: 15 }, // Date
        { width: 30 }, // Item Name
        { width: 15 }, // Orders Count
        { width: 12 }, // Quantity
        { width: 12 }, // Price
        { width: 15 }  // Total
    ];
    
    // Center align all cells in items sheet
    itemsSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        if (rowNumber > 1) { // Skip header
            row.eachCell({ includeEmpty: true }, (cell) => {
                cell.alignment = { horizontal: 'center', vertical: 'middle' };
            });
        }
    });
    
    applyZebraStriping(itemsSheet, 2, itemsSheet.rowCount, itemsHeaders.length);

    // --- Finalize Buffer ---
    return await workbook.xlsx.writeBuffer();
};

module.exports = {
    generateReport,
    formatCurrency: (amt) => `₹${Number(amt).toFixed(2)}`,
    formatDateIST,
    formatDateTimeIST: (d) => d ? `${formatDateIST(d)} ${formatTimeIST(d)}` : ''
};

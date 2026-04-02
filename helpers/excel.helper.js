const ExcelJS = require('exceljs');

/**
 * Generate a professional, styled Excel workbook for reports
 */
exports.createStyledWorkbook = async ({ sheetName, reportTitle, restaurantName, period, columns, rows }) => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(sheetName);

  // 1. ADD BRANDED HEADER (Indigo/Blue Theme)
  const headerRows = [
    ['digitalMenu'],
    [restaurantName],
    [`Report: ${reportTitle}`],
    [`Period: ${period}`],
    [`Generated On: ${new Date().toLocaleString('en-IN')}`],
    [] // Spacer
  ];

  headerRows.forEach((row, idx) => {
    const r = worksheet.addRow(row);
    // Style Row 1 (App Name)
    if (idx === 0) {
      r.getCell(1).font = { name: 'Inter', size: 24, bold: true, color: { argb: 'FF4F46E5' } };
    } else {
      r.getCell(1).font = { name: 'Inter', size: 12, bold: idx < 3, color: { argb: 'FF64748B' } };
    }
  });

  // 2. ADD DATA TABLE
  const startDataRow = headerRows.length + 1;
  const headerRow = worksheet.addRow(columns.map(col => col.header));
  
  // Style Table Header row (Indigo background, white text)
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4F46E5' }
    };
    cell.font = {
      name: 'Inter',
      bold: true,
      color: { argb: 'FFFFFFFF' }
    };
    cell.alignment = { vertical: 'middle', horizontal: 'center' };
    cell.border = {
      bottom: { style: 'medium', color: { argb: 'FF3730A3' } }
    };
  });

  // 3. ADD DATA ROWS with Zebra Striping
  rows.forEach((rowData, idx) => {
    const row = worksheet.addRow(rowData);
    const isEven = idx % 2 === 0;
    
    row.eachCell((cell) => {
      cell.font = { name: 'Inter', size: 10 };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      
      if (!isEven) {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF8FAFC' }
        };
      }
      
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } }
      };
    });
  });

  // 4. AUTO-ADJUST COLUMN WIDTHS
  columns.forEach((col, idx) => {
    const cellValues = rows.map(r => r[idx]);
    const maxLength = Math.max(
      col.header.length,
      ...cellValues.map(v => (v ? v.toString().length : 0))
    );
    worksheet.getColumn(idx + 1).width = Math.min(50, maxLength + 5);
  });

  // Return as Buffer for mailing
  return await workbook.xlsx.writeBuffer();
};

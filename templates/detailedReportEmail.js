/**
 * HTML Email Templates for Detailed Reports and Account Deletion
 */

/**
 * Template for Monthly Detailed Report
 */
exports.detailedReportEmailTemplate = ({ ownerName, restaurantName, month, dateRange, summary, generatedAt }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">Monthly Detailed Report - ${month}</h2>
      <p>Dear ${ownerName || 'Restaurant Owner'},</p>
      <p>Please find attached your comprehensive current month report.</p>
      
      <h3 style="color: #4F46E5; margin-top: 24px;">Report Contents</h3>
      <ul style="line-height: 1.8; color: #374151;">
        <li><strong>Transactions</strong> - Detailed transaction log with 40 columns</li>
        <li><strong>Daily Summary</strong> - Aggregated daily statistics</li>
        <li><strong>Items Breakdown</strong> - Per-item sales analysis</li>
        <li><strong>Payment Summary</strong> - Payment status breakdown</li>
      </ul>

      <h3 style="color: #4F46E5; margin-top: 24px;">Summary (Verified)</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Net Balance</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; color: #059669; font-weight: bold;">₹${summary.netBalance.toFixed(2)}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Total Verified Payments</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">₹${summary.verifiedPayments.toFixed(2)}</td>
        </tr>
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Total Processed Refunds</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right; color: #dc2626;">₹${summary.totalRefunds.toFixed(2)}</td>
        </tr>
        <tr style="background: #ecfdf5;">
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Total Transactions</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${summary.totalCount}</td>
        </tr>
      </table>
      
      <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
        Generated at: ${generatedAt} IST<br>
        Timezone: Asia/Kolkata (IST)
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #9ca3af; font-size: 12px;">
        Digital Menu Order - Automated Monthly Report<br>
        For support, contact: sahin401099@gmail.com
      </p>
    </div>
  `;
};

/**
 * Template for Account Deletion Final Export
 */
exports.accountDeletionExportTemplate = ({ ownerName, restaurantName, summary, exportedAt }) => {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #4F46E5;">Account Deletion - Final Data Export</h2>
      <p>Dear ${ownerName || 'Restaurant Owner'},</p>
      <p>Your DigitalMenu account has been permanently deleted as requested.</p>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px; margin: 24px 0;">
        <p style="margin: 0; color: #dc2626; font-weight: bold;">⚠️ This action cannot be undone.</p>
      </div>
      
      <h3 style="color: #4F46E5;">Attached Files</h3>
      <ul style="line-height: 1.8;">
        <li><strong>Full Report</strong> - Complete transaction history, daily summaries, items breakdown, and payment analysis</li>
        <li><strong>Menu Items</strong> - Your complete menu catalog with prices and settings</li>
      </ul>
      
      <h3 style="color: #4F46E5;">Summary Statistics</h3>
      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Total Transactions</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${summary.totalTransactions}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Total Orders</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${summary.totalOrders}</td>
        </tr>
        <tr style="background: #f3f4f6;">
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Menu Items</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${summary.totalMenuItems}</td>
        </tr>
        <tr>
          <td style="padding: 12px; border: 1px solid #e5e7eb;"><strong>Data Period</strong></td>
          <td style="padding: 12px; border: 1px solid #e5e7eb; text-align: right;">${summary.dateRange}</td>
        </tr>
      </table>
      
      <p style="margin-top: 24px; color: #6b7280; font-size: 14px;">
        Exported at: ${exportedAt} IST<br>
        Keep these files safe as they contain your complete business data.
      </p>
      
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">
      <p style="color: #9ca3af; font-size: 12px;">
        Digital Menu Order - Account Deletion Export<br>
        For support, contact: sahin401099@gmail.com
      </p>
    </div>
  `;
};

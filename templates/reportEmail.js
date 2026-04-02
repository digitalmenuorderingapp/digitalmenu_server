/**
 * Beautiful HTML Email Template for Monthly Reports
 */
exports.reportEmailTemplate = ({ restaurantName, reportType, period, summary }) => {
  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <style>
        body { font-family: 'Inter', system-ui, -apple-system, sans-serif; color: #1e293b; line-height: 1.5; margin: 0; padding: 0; background-color: #f8fafc; }
        .container { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 24px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 40px; text-align: center; color: white; }
        .header h1 { margin: 0; font-size: 24px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; }
        .header p { margin: 10px 0 0; opacity: 0.8; font-weight: 500; }
        .content { padding: 40px; }
        .content h2 { margin: 0 0 20px; font-size: 20px; font-weight: 800; color: #0f172a; }
        .summary-card { background: #f1f5f9; border-radius: 16px; padding: 24px; margin-bottom: 30px; border: 1px solid #e2e8f0; }
        .summary-grid { display: grid; grid-template-cols: 1fr 1fr; gap: 16px; }
        .summary-item { margin-bottom: 12px; }
        .summary-label { font-size: 11px; font-weight: 800; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 4px; }
        .summary-value { font-size: 16px; font-weight: 800; color: #1e293b; }
        .footer { padding: 30px; text-align: center; background: #f8fafc; border-top: 1px solid #e2e8f0; }
        .footer p { margin: 0; font-size: 12px; font-weight: 600; color: #94a3b8; }
        .btn { display: inline-block; background: #4f46e5; color: white; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: 700; font-size: 14px; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>digitalMenu</h1>
            <p>${restaurantName}</p>
        </div>
        <div class="content">
            <h2>Monthly ${reportType} Report</h2>
            <p>Hello,</p>
            <p>Please find the requested <strong>${reportType}</strong> report attached to this email. This report covers the activity for your restaurant during the specified period.</p>
            
            <div class="summary-card">
                <div class="summary-item">
                    <span class="summary-label">Report Period</span>
                    <span class="summary-value">${period}</span>
                </div>
                ${summary ? `
                <div style="margin-top: 16px; height: 1px; background: #e2e8f0; margin-bottom: 16px;"></div>
                <div class="summary-grid">
                    ${Object.entries(summary).map(([label, value]) => `
                        <div class="summary-item">
                            <span class="summary-label">${label}</span>
                            <span class="summary-value">${value}</span>
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>

            <p style="font-size: 14px; color: #64748b;">The attached Excel file contains a detailed day-wise breakdown of all transactions and operational metrics.</p>
            
            <a href="${process.env.ADMIN_URL}/admin/dashboard" class="btn">View Admin Dashboard</a>
        </div>
        <div class="footer">
            <p>&copy; ${new Date().getFullYear()} digitalMenu. All rights reserved.</p>
            <p>Smart Restaurant Menu System</p>
        </div>
    </div>
</body>
</html>
  `;
};

exports.monthlyReportTemplate = (data) => {
  const { restaurantName, ownerName, monthName, year, summary } = data;
  
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Monthly Sales Report</title>
</head>
<body style="margin:0; padding:0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color:#f4f7f6;">
  <div style="max-width:600px; margin:20px auto; background:#ffffff; border-radius:12px; box-shadow:0 10px 25px rgba(0,0,0,0.05); overflow:hidden; border: 1px solid #e1e8ed;">
    
    <!-- Header -->
    <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); color:#ffffff; text-align:center; padding:40px 20px;">
      <h1 style="margin:0; font-size:28px; font-weight:700; letter-spacing: -0.5px;">Monthly Sales Report</h1>
      <p style="margin:10px 0 0; font-size:16px; opacity:0.9;">${monthName} ${year}</p>
    </div>
    
    <!-- Body -->
    <div style="padding:40px; color:#1f2937;">
      <h2 style="font-size:20px; color:#111827; margin-bottom:16px;">Hello ${ownerName || 'Partner'},</h2>
      <p style="font-size:16px; line-height:1.6; color:#4b5563; margin-bottom:30px;">
        Your sales performance report for <strong>${restaurantName}</strong> is ready. We've summarized your key metrics for ${monthName} below.
      </p>
      
      <!-- Stats Grid -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px;">
        <div style="background: #f9fafb; padding: 20px; border-radius: 10px; border: 1px solid #f3f4f6; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total Revenue</p>
          <p style="margin: 5px 0 0; font-size: 24px; font-weight: 700; color: #4f46e5;">₹${summary.totalRevenue.toFixed(2)}</p>
        </div>
        <div style="background: #f9fafb; padding: 20px; border-radius: 10px; border: 1px solid #f3f4f6; text-align: center;">
          <p style="margin: 0; font-size: 14px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Total Orders</p>
          <p style="margin: 5px 0 0; font-size: 24px; font-weight: 700; color: #111827;">${summary.totalOrders}</p>
        </div>
      </div>

      <div style="background: #eff6ff; padding: 20px; border-radius: 12px; border: 1px solid #dbeafe; margin-bottom: 30px;">
        <h3 style="margin: 0 0 12px; font-size: 16px; color: #1e40af;">Payment Breakdown</h3>
        <div style="display: flex; justify-content: space-between; margin-bottom: 8px;">
          <span style="color: #60a5fa;">Cash Revenue</span>
          <span style="font-weight: 600; color: #1e3a8a;">₹${summary.cashRevenue.toFixed(2)}</span>
        </div>
        <div style="display: flex; justify-content: space-between;">
          <span style="color: #60a5fa;">Online Revenue</span>
          <span style="font-weight: 600; color: #1e3a8a;">₹${summary.onlineRevenue.toFixed(2)}</span>
        </div>
      </div>
      
      <p style="font-size:15px; color:#6b7280; line-height:1.6; margin-bottom:20px;">
        A detailed Excel spreadsheet with your daily transactions and top-selling items is attached to this email for your records.
      </p>

      <div style="background: #fff7ed; border-left: 4px solid #f97316; padding: 15px; margin-bottom: 30px;">
        <p style="margin: 0; font-size: 14px; color: #9a3412;">
          <strong>Database Cleaned:</strong> To keep your app running fast, last month's data has been cleared from the database.
        </p>
      </div>
    </div>
    
    <!-- Footer -->
    <div style="background:#f9fafb; text-align:center; padding:30px; border-top: 1px solid #e5e7eb;">
      <p style="margin:0; font-size:14px; color:#9ca3af;">&copy; 2026 DigitalMenu. All rights reserved.</p>
      <p style="margin:10px 0 0; font-size:12px; color:#d1d5db;">You are receiving this automated report because you are a registered restaurant owner.</p>
    </div>
  </div>
</body>
</html>`;
};

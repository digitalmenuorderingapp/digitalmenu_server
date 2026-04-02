exports.registerOtpTemplate = (otp) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Verification Code</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f4f7f6; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #e5e7eb; }
    .top-bar { height: 4px; background: linear-gradient(90deg, #6366f1 0%, #a855f7 100%); }
    .header { text-align: center; padding: 24px 16px 16px; }
    .icon-box { width: 56px; height: 56px; background: #eef2ff; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 28px; }
    .title { margin: 0; font-size: 22px; font-weight: 700; color: #111827; letter-spacing: -0.5px; }
    .body-content { padding: 0 20px 24px; text-align: center; }
    .message { font-size: 15px; line-height: 1.5; color: #4b5563; margin-bottom: 24px; }
    .otp-box { background: #f9fafb; padding: 16px; border-radius: 8px; border: 1px dashed #d1d5db; display: inline-block; margin-bottom: 24px; }
    .otp-code { font-size: 32px; font-weight: 800; color: #4f46e5; letter-spacing: 6px; font-family: monospace; }
    .footer-text { font-size: 13px; color: #9ca3af; margin: 0; line-height: 1.4; }
    .footer { background: #f9fafb; text-align: center; padding: 20px; border-top: 1px solid #f3f4f6; }
    .copyright { margin: 0; font-size: 13px; color: #6b7280; }
    @media only screen and (max-width: 600px) {
      .container { margin: 10px; border-radius: 8px; border: none; }
      .header { padding: 20px 12px 12px; }
      .body-content { padding: 0 16px 20px; }
      .title { font-size: 20px; }
      .otp-code { font-size: 28px; letter-spacing: 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar"></div>
    <div class="header">
      <div class="icon-box">🔐</div>
      <h1 class="title">Verify your identity</h1>
    </div>
    <div class="body-content">
      <p class="message">Thanks for joining DigitalMenu! Use the verification code below to complete your registration.</p>
      <div class="otp-box">
        <span class="otp-code">${otp}</span>
      </div>
      <p class="footer-text">This code will expire in 10 minutes.<br>If you didn't request this code, you can safely ignore this email.</p>
    </div>
    <div class="footer">
      <p class="copyright">&copy; 2026 DigitalMenu. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
};

exports.resetPasswordOtpTemplate = (otp) => {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Password Reset</title>
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #fef2f2; margin: 0; padding: 0; }
    .container { max-width: 600px; margin: 20px auto; background: #ffffff; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); overflow: hidden; border: 1px solid #fee2e2; }
    .top-bar { height: 4px; background: linear-gradient(90deg, #ef4444 0%, #f97316 100%); }
    .header { text-align: center; padding: 24px 16px 16px; }
    .icon-box { width: 56px; height: 56px; background: #fff1f2; border-radius: 12px; margin: 0 auto 16px; display: flex; align-items: center; justify-content: center; font-size: 28px; }
    .title { margin: 0; font-size: 22px; font-weight: 700; color: #991b1b; letter-spacing: -0.5px; }
    .body-content { padding: 0 20px 24px; text-align: center; }
    .message { font-size: 15px; line-height: 1.5; color: #7f1d1d; margin-bottom: 24px; }
    .otp-box { background: #fff5f5; padding: 16px; border-radius: 8px; border: 1px dashed #fecaca; display: inline-block; margin-bottom: 24px; }
    .otp-code { font-size: 32px; font-weight: 800; color: #dc2626; letter-spacing: 6px; font-family: monospace; }
    .footer-text { font-size: 13px; color: #991b1b; opacity: 0.8; margin: 0; line-height: 1.4; }
    .footer { background: #fffafa; text-align: center; padding: 20px; border-top: 1px solid #fee2e2; }
    .copyright { margin: 0; font-size: 13px; color: #b91c1c; }
    @media only screen and (max-width: 600px) {
      .container { margin: 10px; border-radius: 8px; border: none; }
      .header { padding: 20px 12px 12px; }
      .body-content { padding: 0 16px 20px; }
      .title { font-size: 20px; }
      .otp-code { font-size: 28px; letter-spacing: 4px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar"></div>
    <div class="header">
      <div class="icon-box">🔑</div>
      <h1 class="title">Password Reset Request</h1>
    </div>
    <div class="body-content">
      <p class="message">We received a request to reset your password. Use the following code to proceed:</p>
      <div class="otp-box">
        <span class="otp-code">${otp}</span>
      </div>
      <p class="footer-text">This code is valid for 15 minutes.<br>If you didn't request a password reset, please change your password immediately or contact support.</p>
    </div>
    <div class="footer">
      <p class="copyright">&copy; 2026 DigitalMenu. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`;
};

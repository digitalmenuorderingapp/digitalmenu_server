const nodemailer = require('nodemailer');

// Lazy initialization of transporter to ensure env vars are loaded
let transporter = null;

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      connectionTimeout: 10000, // 10 second timeout
      socketTimeout: 10000,
      greetingTimeout: 10000,
    });
  }
  return transporter;
};

exports.sendEmailWithAttachments = async (to, subject, text, attachments, html = '') => {
  try {
    // Skip if SMTP not configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      console.log('[Email] SMTP not configured, skipping email to:', to);
      return { skipped: true, reason: 'SMTP not configured' };
    }

    const mailOptions = {
      from: `"DigitalMenu Reports" <${process.env.SMTP_USER}>`,
      to,
      subject,
      text,
      html,
      attachments,
    };

    const info = await getTransporter().sendMail(mailOptions);
    console.log('Message sent: %s', info.messageId);
    return info;
  } catch (error) {
    console.error('[Email] Failed to send email:', error.message);
    // Don't throw - gracefully fail so app continues
    return { error: error.message, sent: false };
  }
};

/**
 * Send a generic HTML email
 * Mirrors the pattern from the reference project
 */
exports.sendEmail = async ({ to, subject, html }) => {
  try {
    // Skip if SMTP not configured
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      console.log('[Email] SMTP not configured, skipping email to:', to);
      return { skipped: true, reason: 'SMTP not configured' };
    }

    const mailOptions = {
      from: process.env.SMTP_USER,
      to,
      subject,
      html
    };

    const info = await getTransporter().sendMail(mailOptions);
    console.log('Email sent successfully to:', to);
    return info;
  } catch (error) {
    console.error('[Email] Failed to send email:', error.message);
    // Don't throw - gracefully fail so app continues
    return { error: error.message, sent: false };
  }
};

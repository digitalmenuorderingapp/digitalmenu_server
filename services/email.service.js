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
    });
  }
  return transporter;
};

exports.sendEmailWithAttachments = async (to, subject, text, attachments, html = '') => {
  try {
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
    console.error('Error sending email:', error);
    throw error;
  }
};

/**
 * Send a generic HTML email
 * Mirrors the pattern from the reference project
 */
exports.sendEmail = async ({ to, subject, html }) => {
  try {
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
    console.error('Error sending email:', error);
    throw error;
  }
};

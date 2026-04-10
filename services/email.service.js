const { Resend } = require('resend');

// Initialize Resend with API key from env
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

exports.sendEmailWithAttachments = async (to, subject, text, attachments, html = '') => {
  try {
    if (!resend) {
      console.log('[Email] Resend not configured, skipping email to:', to);
      return { skipped: true, reason: 'Resend not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'digitalmenu.orderingapp@zohomail.in',
      to,
      subject,
      html: html || text,
      attachments: attachments?.map(att => ({
        filename: att.filename,
        content: att.content
      }))
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      return { error: error.message, sent: false };
    }

    console.log('[Email] Sent:', data?.id);
    return { id: data?.id, sent: true };
  } catch (error) {
    console.error('[Email] Failed to send email:', error.message);
    return { error: error.message, sent: false };
  }
};

/**
 * Send a generic HTML email
 */
exports.sendEmail = async ({ to, subject, html }) => {
  try {
    if (!resend) {
      console.log('[Email] Resend not configured, skipping email to:', to);
      return { skipped: true, reason: 'Resend not configured' };
    }

    const { data, error } = await resend.emails.send({
      from: process.env.FROM_EMAIL || 'digitalmenu.orderingapp@zohomail.in',
      to,
      subject,
      html
    });

    if (error) {
      console.error('[Email] Resend error:', error);
      return { error: error.message, sent: false };
    }

    console.log('[Email] Sent successfully to:', to);
    return { id: data?.id, sent: true };
  } catch (error) {
    console.error('[Email] Failed to send email:', error.message);
    return { error: error.message, sent: false };
  }
};

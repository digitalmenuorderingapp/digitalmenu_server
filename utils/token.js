const crypto = require('crypto');
// Hash token using SHA256
exports.hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

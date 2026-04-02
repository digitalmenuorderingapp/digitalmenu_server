const crypto = require('crypto');
const RefreshToken = require('../models/RefreshToken');

// Hash token using SHA256
exports.hashToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

// Validate refresh token
exports.validateToken = async (token) => {
  const refreshTokenDoc = await RefreshToken.findOne({ 
    tokenHash: exports.hashToken(token) 
  });
  
  if (!refreshTokenDoc) {
    return null;
  }

  // Check if token is revoked
  if (refreshTokenDoc.revokedAt && refreshTokenDoc.revokedAt < new Date()) {
    return null;
  }

  // Check if token is expired
  if (refreshTokenDoc.expiresAt < new Date()) {
    return null;
  }

  return refreshTokenDoc;
};

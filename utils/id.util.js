/**
 * Generates a shorter, human-readable ID for restaurants.
 * Format: 6 characters, numbers (0-9) and capital letters (A-Z).
 * Example: DM7X2B
 */
const generateShortId = (length = 6) => {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

module.exports = {
  generateShortId
};

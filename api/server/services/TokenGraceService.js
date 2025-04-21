/**
 * TokenGraceService.js
 *
 * This service provides a grace period for refresh tokens to mitigate race conditions
 * when multiple refresh token requests occur simultaneously.
 */

// Simple in-memory store for recently invalidated tokens
// In production, you might want to use Redis or another distributed cache
const graceTokens = new Map();

// How long tokens remain valid in the grace period (milliseconds)
const GRACE_PERIOD_MS = 5000; // 5 seconds

/**
 * Add a token to the grace period cache
 * @param {string} token - The refresh token that was just invalidated
 * @param {string} userId - The user ID associated with the token
 */
const addToGracePeriod = (token, userId) => {
  if (!token || !userId) {
    return;
  }
  
  graceTokens.set(token, {
    userId,
    expiresAt: Date.now() + GRACE_PERIOD_MS,
  });
  
  // Schedule cleanup after grace period
  setTimeout(() => {
    graceTokens.delete(token);
  }, GRACE_PERIOD_MS);
};

/**
 * Check if a token is in the grace period
 * @param {string} token - The refresh token to check
 * @param {string} userId - The user ID to validate against
 * @returns {boolean} - True if the token is valid in grace period
 */
const isInGracePeriod = (token, userId) => {
  if (!token || !userId) {
    return false;
  }
  
  const graceEntry = graceTokens.get(token);
  if (!graceEntry) {
    return false;
  }
  
  // Check if token belongs to the same user and is not expired
  return graceEntry.userId === userId && graceEntry.expiresAt > Date.now();
};

/**
 * Clean up expired tokens from the grace period cache
 * This is automatically called by setTimeout, but can be manually triggered
 */
const cleanupExpiredTokens = () => {
  const now = Date.now();
  for (const [token, entry] of graceTokens.entries()) {
    if (entry.expiresAt <= now) {
      graceTokens.delete(token);
    }
  }
};

module.exports = {
  addToGracePeriod,
  isInGracePeriod,
  cleanupExpiredTokens,
};

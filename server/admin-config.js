/**
 * Admin Access Configuration
 * Handles admin secret key validation for unlimited access
 */

/**
 * Get admin secret key (checked at runtime, not import time)
 * @returns {string} - The admin secret key
 */
function getAdminSecretKey() {
  return process.env.ADMIN_SECRET_KEY || 'change-me-in-production'
}

/**
 * Validates admin access key
 * @param {string} key - The admin key to validate
 * @returns {boolean} - Whether the key is valid
 */
export function isValidAdminKey(key) {
  return key === getAdminSecretKey()
}

export default {
  isValidAdminKey
}

/**
 * Admin Access Configuration
 * Handles admin secret key validation for unlimited access
 */

/**
 * Get admin secret key (checked at runtime, not import time)
 * @returns {string} - The admin secret key
 * @throws {Error} - If ADMIN_SECRET_KEY is not configured
 */
function getAdminSecretKey() {
  if (!process.env.ADMIN_SECRET_KEY) {
    throw new Error('ADMIN_SECRET_KEY environment variable is required')
  }
  return process.env.ADMIN_SECRET_KEY
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

/**
 * Admin Access Configuration
 * Handles admin secret key validation for unlimited access
 */

export const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'change-me-in-production'

/**
 * Validates admin access key
 * @param {string} key - The admin key to validate
 * @returns {boolean} - Whether the key is valid
 */
export function isValidAdminKey(key) {
  return key === ADMIN_SECRET_KEY
}

export default {
  ADMIN_SECRET_KEY,
  isValidAdminKey
}

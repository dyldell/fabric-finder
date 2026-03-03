/**
 * Anonymous User Tracking
 * Generates persistent user IDs to prevent scan limit bypass
 * Uses cookies + localStorage + browser fingerprinting
 */

const USER_ID_KEY = 'fabricfinder_uid'
const USER_ID_COOKIE = 'ff_uid'

/**
 * Generate a unique user ID
 */
function generateUserId() {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 15)
  return `usr_${timestamp}_${random}`
}

/**
 * Get browser fingerprint (backup identifier)
 * Creates a hash based on browser/device characteristics
 */
export async function getBrowserFingerprint() {
  const components = []

  // User agent
  components.push(navigator.userAgent)

  // Screen resolution
  components.push(`${screen.width}x${screen.height}x${screen.colorDepth}`)

  // Timezone
  components.push(Intl.DateTimeFormat().resolvedOptions().timeZone)

  // Language
  components.push(navigator.language)

  // Platform
  components.push(navigator.platform)

  // Hardware concurrency (CPU cores)
  components.push(navigator.hardwareConcurrency || 'unknown')

  // Canvas fingerprint (more unique)
  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    ctx.textBaseline = 'top'
    ctx.font = '14px Arial'
    ctx.fillText('FabricFinder', 2, 2)
    components.push(canvas.toDataURL())
  } catch (e) {
    components.push('canvas-error')
  }

  // Create hash
  const fingerprint = await simpleHash(components.join('|||'))
  return `fp_${fingerprint}`
}

/**
 * Simple hash function
 * Falls back to simple string hash if crypto.subtle unavailable (non-HTTPS)
 */
async function simpleHash(str) {
  // Check if crypto.subtle is available (requires HTTPS or localhost)
  if (window.crypto && window.crypto.subtle) {
    try {
      const encoder = new TextEncoder()
      const data = encoder.encode(str)
      const hashBuffer = await crypto.subtle.digest('SHA-256', data)
      const hashArray = Array.from(new Uint8Array(hashBuffer))
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
      return hashHex.substring(0, 16)
    } catch (e) {
      console.warn('crypto.subtle failed, using fallback hash')
    }
  }

  // Fallback: simple string hash for non-HTTPS contexts
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(16).padStart(16, '0').substring(0, 16)
}

/**
 * Set cookie
 */
function setCookie(name, value, days = 365) {
  const expires = new Date()
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000)
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/;SameSite=Lax`
}

/**
 * Get cookie
 */
function getCookie(name) {
  const value = `; ${document.cookie}`
  const parts = value.split(`; ${name}=`)
  if (parts.length === 2) return parts.pop().split(';').shift()
  return null
}

/**
 * Get or create user ID
 * Checks: Cookie → localStorage → generates new
 */
export async function getUserId() {
  // Check cookie first
  let userId = getCookie(USER_ID_COOKIE)

  // Check localStorage
  if (!userId) {
    userId = localStorage.getItem(USER_ID_KEY)
  }

  // Generate new if none found
  if (!userId) {
    userId = generateUserId()
  }

  // Store in both places
  setCookie(USER_ID_COOKIE, userId, 365)
  localStorage.setItem(USER_ID_KEY, userId)

  return userId
}

/**
 * Get user identifiers (ID + fingerprint)
 */
export async function getUserIdentifiers() {
  const userId = await getUserId()
  const fingerprint = await getBrowserFingerprint()

  return {
    userId,
    fingerprint
  }
}

/**
 * Clear user tracking (for testing)
 */
export function clearUserTracking() {
  localStorage.removeItem(USER_ID_KEY)
  setCookie(USER_ID_COOKIE, '', -1)
}

export default {
  getUserId,
  getUserIdentifiers,
  getBrowserFingerprint,
  clearUserTracking
}

/**
 * Scan Tracking Utilities
 * Tracks free tier scan usage using localStorage
 * Resets monthly for fair usage
 */

const SCANS_KEY = 'fabricfinder_scans'
const MONTH_KEY = 'fabricfinder_month'
const MAX_FREE_SCANS = 5

/**
 * Get current month identifier (YYYY-MM)
 */
export function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${now.getMonth() + 1}`
}

/**
 * Get number of scans remaining this month
 * Auto-resets if new month
 */
export function getScansRemaining() {
  const currentMonth = getCurrentMonth()
  const storedMonth = localStorage.getItem(MONTH_KEY)

  // Reset if new month
  if (storedMonth !== currentMonth) {
    localStorage.setItem(MONTH_KEY, currentMonth)
    localStorage.setItem(SCANS_KEY, '0')
    return MAX_FREE_SCANS
  }

  const scansUsed = parseInt(localStorage.getItem(SCANS_KEY) || '0', 10)
  return Math.max(0, MAX_FREE_SCANS - scansUsed)
}

/**
 * Get number of scans used this month
 */
export function getScansUsed() {
  const currentMonth = getCurrentMonth()
  const storedMonth = localStorage.getItem(MONTH_KEY)

  // Reset if new month
  if (storedMonth !== currentMonth) {
    return 0
  }

  return parseInt(localStorage.getItem(SCANS_KEY) || '0', 10)
}

/**
 * Increment scan count
 * Called after successful scan
 */
export function incrementScanCount() {
  const scansUsed = getScansUsed()
  localStorage.setItem(SCANS_KEY, String(scansUsed + 1))
  localStorage.setItem(MONTH_KEY, getCurrentMonth())
}

/**
 * Check if user can perform another scan
 */
export function canScan() {
  return getScansRemaining() > 0
}

/**
 * Reset scan count (for testing or admin override)
 */
export function resetScanCount() {
  localStorage.setItem(SCANS_KEY, '0')
  localStorage.setItem(MONTH_KEY, getCurrentMonth())
}

export default {
  getCurrentMonth,
  getScansRemaining,
  getScansUsed,
  incrementScanCount,
  canScan,
  resetScanCount,
  MAX_FREE_SCANS
}

import { getScansRemaining } from '../utils/scanTracking'
import './ScanLimitBanner.css'

export default function ScanLimitBanner({ isAdmin }) {
  // Admin users don't see limits
  if (isAdmin) {
    return null
  }

  const remaining = getScansRemaining()

  // No scans remaining - show upgrade prompt
  if (remaining === 0) {
    return (
      <div className="limit-banner limit-reached">
        <div className="limit-content">
          <span className="limit-icon">⚠️</span>
          <div className="limit-text">
            <strong>You've used all 3 free scans this month</strong>
            <p>Upgrade to Premium for unlimited scans, no ads, and priority support</p>
          </div>
        </div>
        <button className="upgrade-btn" disabled>
          Upgrade to Premium - $9.99/mo
        </button>
      </div>
    )
  }

  // Low scans remaining - show warning
  if (remaining <= 1) {
    return (
      <div className="limit-banner limit-warning">
        <div className="limit-content">
          <span className="limit-icon">⏳</span>
          <div className="limit-text">
            <strong>{remaining} scan{remaining === 1 ? '' : 's'} remaining this month</strong>
            <p>Get unlimited scans with Premium</p>
          </div>
        </div>
        <button className="upgrade-btn-small" disabled>
          Go Premium
        </button>
      </div>
    )
  }

  // Still have enough scans - no banner shown
  return null
}

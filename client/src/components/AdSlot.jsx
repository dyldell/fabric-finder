import { useEffect } from 'react'
import './AdSlot.css'

export default function AdSlot({ isAdmin }) {
  // Don't show ads for admin users
  if (isAdmin) {
    return null
  }

  useEffect(() => {
    try {
      // Load AdSense ad
      (window.adsbygoogle = window.adsbygoogle || []).push({})
    } catch (error) {
      // Silently fail in production
      if (import.meta.env.DEV) {
        console.error('AdSense error:', error)
      }
    }
  }, [])

  return (
    <div className="ad-container">
      <div className="ad-label">Advertisement</div>
      <ins
        className="adsbygoogle"
        style={{ display: 'block' }}
        data-ad-client="ca-pub-XXXXXXXXXX"  // TODO: Replace with actual AdSense client ID
        data-ad-slot="XXXXXXXXXX"            // TODO: Replace with actual ad slot ID
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  )
}

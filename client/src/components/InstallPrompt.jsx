import { useState, useEffect } from 'react'
import './InstallPrompt.css'

export default function InstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false)
  const [deferredPrompt, setDeferredPrompt] = useState(null)

  useEffect(() => {
    // Check if already installed
    if (window.matchMedia('(display-mode: standalone)').matches) {
      return // Already installed, don't show prompt
    }

    // Check if user has dismissed before
    const dismissed = localStorage.getItem('install-prompt-dismissed')
    if (dismissed) {
      return
    }

    // Listen for beforeinstallprompt event (Chrome/Edge)
    const handler = (e) => {
      e.preventDefault()
      setDeferredPrompt(e)

      // Show prompt after a delay (don't be annoying immediately)
      setTimeout(() => {
        setShowPrompt(true)
      }, 3000)
    }

    window.addEventListener('beforeinstallprompt', handler)

    // For iOS, show prompt after a few seconds
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    if (isIOS) {
      setTimeout(() => {
        setShowPrompt(true)
      }, 5000)
    }

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleInstall = async () => {
    if (!deferredPrompt) {
      // iOS - show instructions
      return
    }

    // Show browser install prompt
    deferredPrompt.prompt()
    const { outcome } = await deferredPrompt.userChoice

    if (outcome === 'accepted') {
      console.log('✅ App installed')
    }

    setShowPrompt(false)
    setDeferredPrompt(null)
  }

  const handleDismiss = () => {
    setShowPrompt(false)
    localStorage.setItem('install-prompt-dismissed', 'true')
  }

  if (!showPrompt) return null

  // Detect iOS for special instructions
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

  return (
    <div className="install-prompt-overlay">
      <div className="install-prompt-card">
        <button
          className="install-prompt-close"
          onClick={handleDismiss}
          aria-label="Dismiss"
        >
          ✕
        </button>

        <div className="install-prompt-icon">📱</div>

        <h3 className="install-prompt-title">
          Install Fabric Finder
        </h3>

        <p className="install-prompt-description">
          Add to your home screen for faster access and a better experience
        </p>

        {isIOS ? (
          <div className="install-prompt-ios">
            <p className="ios-instructions">
              Tap the Share button <span className="ios-share-icon">⎋</span> in Safari,
              then select <strong>"Add to Home Screen"</strong>
            </p>
          </div>
        ) : (
          <div className="install-prompt-actions">
            <button
              className="install-prompt-btn-primary"
              onClick={handleInstall}
            >
              Install App
            </button>
            <button
              className="install-prompt-btn-secondary"
              onClick={handleDismiss}
            >
              Maybe Later
            </button>
          </div>
        )}

        <div className="install-prompt-benefits">
          <div className="benefit-item">✓ Faster loading</div>
          <div className="benefit-item">✓ Works offline</div>
          <div className="benefit-item">✓ No app store needed</div>
        </div>
      </div>
    </div>
  )
}

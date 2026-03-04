import { useState, useEffect } from 'react'
import './AnalysisForm.css'

const AnalysisForm = ({ onAnalyze, loading }) => {
  const [url, setUrl] = useState('')
  const [loadingMessage, setLoadingMessage] = useState('')
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    if (loading) {
      setProgress(0)
      setLoadingMessage('Reading product page...')

      const timer1 = setTimeout(() => {
        setLoadingMessage('Extracting fabric data...')
        setProgress(40)
      }, 3000)

      const timer2 = setTimeout(() => {
        setLoadingMessage('Almost done...')
        setProgress(75)
      }, 8000)

      const progressTimer = setInterval(() => {
        setProgress(prev => {
          if (prev >= 95) return prev
          return prev + 0.5
        })
      }, 100)

      return () => {
        clearTimeout(timer1)
        clearTimeout(timer2)
        clearInterval(progressTimer)
      }
    } else {
      setProgress(0)
      setLoadingMessage('')
    }
  }, [loading])

  const handleSubmit = (e) => {
    e.preventDefault()
    if (url.trim()) {
      onAnalyze(url.trim())
    }
  }

  return (
    <div className="analysis-form-container">
      <form onSubmit={handleSubmit} className="analysis-form">
        <input
          id="product-url"
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Paste any clothing URL to uncover the fabric..."
          className="form-input"
          disabled={loading}
          required
        />

        {loading ? (
          <div className="loading-container">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="loading-message">{loadingMessage}</div>
          </div>
        ) : (
          <button
            type="submit"
            className="analyze-button"
            disabled={!url.trim()}
          >
            Analyze Fabric
          </button>
        )}

        <p className="form-hint">
          Works with Lululemon · Alo Yoga · Patagonia · Vuori · Amazon · and thousands more
        </p>
      </form>
    </div>
  )
}

export default AnalysisForm

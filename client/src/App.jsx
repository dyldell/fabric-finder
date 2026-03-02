import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import AnalysisForm from './components/AnalysisForm'
import Results from './components/Results'
import './App.css'

function App() {
  const [results, setResults] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [currentUrl, setCurrentUrl] = useState(null)

  const handleAnalyze = async (url, refresh = false) => {
    setLoading(true)
    setError(null)
    if (!refresh) {
      setResults(null)
    }

    try {
      // Use streaming endpoint for real-time updates
      const response = await fetch('/api/analyze-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, refresh }),
      })

      if (!response.ok) {
        const data = await response.json()
        const errorMessage = data.message || data.error || 'Failed to analyze product'
        const errorHint = data.hint ? `\n\n${data.hint}` : ''
        throw new Error(errorMessage + errorHint)
      }

      // Read Server-Sent Events stream
      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      let fabricData = null
      let alternatives = null

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Decode chunk
        const chunk = decoder.decode(value, { stream: true })
        const lines = chunk.split('\n')

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data:')) continue

          try {
            const data = JSON.parse(line.replace(/^data: /, ''))

            // Handle different event types
            const eventLine = lines[lines.indexOf(line) - 1]
            const eventType = eventLine?.replace(/^event: /, '').trim()

            if (eventType === 'status') {
              console.log('Status:', data.message)
              // You can update UI with status messages here
            } else if (eventType === 'fabric') {
              fabricData = data
              // Show fabric data immediately
              setResults({ ...data, alternatives: [] })
            } else if (eventType === 'alternatives') {
              alternatives = data.alternatives
            } else if (eventType === 'complete') {
              // Final results
              if (fabricData && alternatives) {
                setResults({ ...fabricData, alternatives })
              }
              setCurrentUrl(url)
            } else if (eventType === 'error') {
              throw new Error(data.message || 'Analysis failed')
            }
          } catch (parseError) {
            console.warn('Failed to parse SSE event:', parseError)
          }
        }
      }

    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRefresh = () => {
    if (currentUrl) {
      handleAnalyze(currentUrl, true)
    }
  }

  return (
    <div className="app">
      <Navbar />
      <Hero />

      <main className="container">
        <AnalysisForm
          onAnalyze={handleAnalyze}
          loading={loading}
        />

        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
              className="error-message"
            >
              <div className="error-icon">✕</div>
              <div className="error-content">
                {error.split('\n\n').map((paragraph, index) => (
                  <p key={index}>{paragraph}</p>
                ))}
              </div>
              <button
                className="error-retry"
                onClick={() => {
                  setError(null)
                  setResults(null)
                }}
              >
                Try Again
              </button>
            </motion.div>
          )}

          {results && (
            <Results key="results" data={results} />
          )}
        </AnimatePresence>
      </main>

      <footer className="footer">
        <p>© 2026 Fabric Finder • Know what you're wearing</p>
      </footer>
    </div>
  )
}

export default App

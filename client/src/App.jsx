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
      let buffer = '' // Accumulate chunks

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')

        // Keep the last incomplete line in buffer
        buffer = lines.pop() || ''

        // Process complete lines
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim()
          if (!line) continue

          // Parse event type
          if (line.startsWith('event:')) {
            const eventType = line.replace(/^event:\s*/, '').trim()
            // Next line should be data
            const dataLine = lines[i + 1]?.trim()
            if (dataLine?.startsWith('data:')) {
              try {
                const data = JSON.parse(dataLine.replace(/^data:\s*/, ''))

                if (eventType === 'status') {
                  console.log('Status:', data.message)
                } else if (eventType === 'fabric') {
                  fabricData = data
                  setResults({ ...data, alternatives: [] })
                } else if (eventType === 'alternatives') {
                  alternatives = data.alternatives
                } else if (eventType === 'complete') {
                  if (fabricData && alternatives) {
                    setResults({ ...fabricData, alternatives })
                  }
                  setCurrentUrl(url)
                } else if (eventType === 'error') {
                  throw new Error(data.message || 'Analysis failed')
                }
              } catch (parseError) {
                console.warn('Failed to parse SSE event:', parseError, dataLine)
              }
              i++ // Skip the data line we just processed
            }
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

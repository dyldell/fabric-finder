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

  const handleAnalyze = async (url) => {
    setLoading(true)
    setError(null)
    setResults(null)

    try {
      const response = await fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url }),
      })

      const data = await response.json()

      if (!response.ok) {
        // Handle API error with detailed message
        const errorMessage = data.message || data.error || 'Failed to analyze product'
        const errorHint = data.hint ? `\n\n${data.hint}` : ''
        throw new Error(errorMessage + errorHint)
      }

      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
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

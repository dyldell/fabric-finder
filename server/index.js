import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// Middleware
app.use(cors())
app.use(express.json())

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

// Initialize Firecrawl client
const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY,
})

// Firecrawl scraping function
async function scrapeWithFirecrawl(url) {
  console.log(`[Firecrawl] Scraping URL: ${url}`)

  try {
    // Scrape the product page with Firecrawl
    const scrapeResult = await firecrawl.scrape(url, {
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 5000,
    })

    if (!scrapeResult || !scrapeResult.markdown) {
      console.error('[Firecrawl] Scrape failed: No content returned')
      return {
        success: false,
        error: 'Failed to scrape page - no content returned'
      }
    }

    console.log('[Firecrawl] Successfully scraped page')

    // Return the markdown content (cleaner for Claude to parse)
    return {
      success: true,
      content: scrapeResult.markdown,
      url
    }
  } catch (error) {
    console.error('[Firecrawl Error]:', error.message)
    return {
      success: false,
      error: error.message
    }
  }
}

// Extract fabric composition using Claude API
async function extractFabricComposition(scrapedContent) {
  const prompt = `You are a fabric composition analyzer. Analyze the following product page content and extract:
1. Fabric composition (e.g., "87% Nylon, 13% Spandex") - return as array of objects with "type" and "percentage"
2. Quality tier (e.g., "premium athletic", "basic", "luxury")
3. Key features (e.g., ["moisture-wicking", "4-way stretch"])

Return ONLY a valid JSON object with this exact structure:
{
  "fabrics": [
    {"type": "Nylon", "percentage": 87},
    {"type": "Spandex", "percentage": 13}
  ],
  "quality_tier": "premium athletic",
  "features": ["moisture-wicking", "4-way stretch"]
}

Product page content:
${scrapedContent}

Return ONLY the JSON object, no other text.`

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    })

    const responseText = message.content[0].text

    // Parse the JSON response
    const fabricData = JSON.parse(responseText)
    return fabricData
  } catch (error) {
    console.error('[Claude API Error]:', error)
    throw new Error('Failed to extract fabric composition')
  }
}

// API Routes
app.post('/api/analyze', async (req, res) => {
  try {
    const { url } = req.body

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    console.log(`[Analysis Started] URL: ${url}`)

    // Step 1: Scrape with Firecrawl
    const scrapedData = await scrapeWithFirecrawl(url)

    if (!scrapedData.success) {
      return res.status(500).json({ error: 'Failed to scrape product page' })
    }

    // Step 2: Extract fabric composition with Claude
    const fabricData = await extractFabricComposition(scrapedData.content)

    console.log('[Analysis Complete]', fabricData)

    // Return results
    res.json(fabricData)

  } catch (error) {
    console.error('[API Error]:', error)
    res.status(500).json({ error: error.message || 'Analysis failed' })
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('../client/dist'))

  app.get('*', (req, res) => {
    res.sendFile(path.resolve('../client/dist/index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Fabric Finder server running on http://localhost:${PORT}`)
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
})

import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { createClient } from '@supabase/supabase-js'

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

// Initialize Supabase client (use SERVICE_KEY for server-side operations)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

// Normalize URL for matching (remove query params, trailing slashes)
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url)
    return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

// Extract brand from URL
function extractBrand(url) {
  const brandMap = {
    'nike.com': 'Nike',
    'lululemon.com': 'Lululemon',
    'athleta.gap.com': 'Athleta',
    'fabletics.com': 'Fabletics',
    'vuoriclothing.com': 'Vuori',
    'aloyoga.com': 'Alo Yoga',
    'patagonia.com': 'Patagonia',
    'skims.com': 'Skims',
    'outdoorvoices.com': 'Outdoor Voices',
    'beyondyoga.com': 'Beyond Yoga',
    'sweatybetty.com': 'Sweaty Betty',
    'gymshark.com': 'Gymshark',
    'rhone.com': 'Rhone',
    'tenthousand.cc': 'Ten Thousand',
    'carbon38.com': 'Carbon38',
  }

  for (const [domain, brand] of Object.entries(brandMap)) {
    if (url.includes(domain)) return brand
  }
  return 'Unknown'
}

// Check cache for existing product data
async function checkCache(url) {
  const normalizedUrl = normalizeUrl(url)

  try {
    const { data, error } = await supabase
      .from('products_cache')
      .select('*')
      .or(`url.eq.${url},product_url_normalized.eq.${normalizedUrl}`)
      .limit(1)
      .single()

    if (error || !data) {
      console.log('[Cache] Miss - URL not found')
      return null
    }

    console.log('[Cache] Hit - Found cached data')
    return data
  } catch (error) {
    console.log('[Cache] Error checking cache:', error.message)
    return null
  }
}

// Save product data to cache
async function saveToCache(url, fabricData) {
  const normalizedUrl = normalizeUrl(url)
  const brand = extractBrand(url)

  try {
    const { data, error } = await supabase
      .from('products_cache')
      .upsert({
        url,
        product_url_normalized: normalizedUrl,
        brand,
        fabrics: fabricData.fabrics || [],
        quality_tier: fabricData.quality_tier,
        features: fabricData.features || [],
        scraped_at: new Date().toISOString(),
        scrape_success: true,
      }, {
        onConflict: 'url'
      })
      .select()

    if (error) {
      console.error('[Cache] Error saving to cache:', error.message)
    } else {
      console.log('[Cache] Saved successfully')
    }
  } catch (error) {
    console.error('[Cache] Error saving to cache:', error.message)
  }
}

// Improved Firecrawl scraping with better error handling
async function scrapeWithFirecrawl(url) {
  console.log(`[Firecrawl] Scraping URL: ${url}`)

  // Detect if URL needs special JSON extraction (Alo Yoga, Lululemon)
  const useJsonExtraction = url.includes('aloyoga.com') || url.includes('lululemon.com')
  const needsStealth = useJsonExtraction || url.includes('patagonia.com')

  try {
    // For Alo Yoga and Lululemon, use JSON extraction instead of markdown
    if (useJsonExtraction) {
      const brand = url.includes('aloyoga.com') ? 'Alo Yoga' : 'Lululemon'
      console.log(`[Firecrawl] Using JSON extraction for ${brand}`)

      const scrapeOptions = {
        formats: [{
          type: 'json',
          prompt: 'Extract the fabric composition, product name, price, and features from this product page. Look in the product details, materials section, fabric & care section.',
          schema: {
            type: 'object',
            properties: {
              product_name: { type: 'string' },
              price: { type: 'string' },
              fabrics: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    type: { type: 'string' },
                    percentage: { type: 'number' }
                  }
                }
              },
              features: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        }],
        proxy: 'stealth',
        waitFor: 12000
      }

      const scrapeResult = await firecrawl.scrape(url, scrapeOptions)

      if (!scrapeResult || !scrapeResult.json) {
        console.error('[Firecrawl] JSON extraction failed')
        return {
          success: false,
          error: 'Failed to extract product data'
        }
      }

      console.log(`[Firecrawl] JSON extraction successful`)

      // Return in format compatible with Claude extraction
      return {
        success: true,
        content: null, // No markdown content needed
        fabricData: scrapeResult.json, // Direct fabric data from JSON extraction
        url
      }
    }

    // Standard markdown extraction for other sites
    const scrapeOptions = {
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 10000,
      timeout: 60000,
    }

    // Add stealth proxy for anti-bot sites
    if (needsStealth) {
      scrapeOptions.proxy = 'stealth'
      scrapeOptions.mobile = true
      console.log(`[Firecrawl] Using STEALTH mode for anti-bot protection`)
    }

    const scrapeResult = await firecrawl.scrape(url, scrapeOptions)

    if (!scrapeResult || !scrapeResult.markdown) {
      console.error('[Firecrawl] Scrape failed: No content returned')
      return {
        success: false,
        error: 'Failed to scrape page - no content returned'
      }
    }

    const contentLength = scrapeResult.markdown.length
    console.log(`[Firecrawl] Success - Content length: ${contentLength} chars`)

    if (contentLength < 200) {
      console.warn('[Firecrawl] Warning: Content seems short, may be incomplete')
    }

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

    let responseText = message.content[0].text

    // Strip code fences if present (```json ... ```)
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

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

    // Validate Lululemon URLs - www.lululemon.com/products/ URLs often redirect incorrectly
    if (url.includes('www.lululemon.com/products/')) {
      return res.status(400).json({
        error: 'Invalid Lululemon URL format',
        message: 'Please use shop.lululemon.com URLs instead of www.lululemon.com/products/. Example: https://shop.lululemon.com/p/women-pants/Align-Pant-2/_/prod8780551',
        hint: 'Navigate to the product on Lululemon\'s website and copy the URL from the address bar'
      })
    }

    console.log(`\n[Analysis Started] URL: ${url}`)

    // Step 1: Check cache first (HYBRID SYSTEM)
    const cachedData = await checkCache(url)

    if (cachedData) {
      console.log('[Cache] Returning cached result ⚡')

      // Generate alternatives even for cached results
      const alternatives = generateAmazonAlternatives(
        {
          fabrics: cachedData.fabrics,
          quality_tier: cachedData.quality_tier,
          features: cachedData.features
        },
        cachedData.brand,
        'athletic wear'
      )

      return res.json({
        fabrics: cachedData.fabrics,
        quality_tier: cachedData.quality_tier,
        features: cachedData.features,
        alternatives,
        brand: cachedData.brand,
        cached: true,
        cached_at: cachedData.scraped_at
      })
    }

    // Step 2: Not in cache - scrape with Firecrawl
    console.log('[Cache] Not found - scraping in real-time...')
    const scrapedData = await scrapeWithFirecrawl(url)

    if (!scrapedData.success) {
      return res.status(500).json({
        error: 'Failed to scrape product page',
        details: scrapedData.error
      })
    }

    // Step 3: Extract fabric composition
    let fabricData

    if (scrapedData.fabricData) {
      // JSON extraction already provided the data (Alo Yoga)
      console.log('[Analysis] Using JSON-extracted data')
      fabricData = scrapedData.fabricData
    } else {
      // Use Claude API to extract from markdown content
      console.log('[Analysis] Extracting with Claude API')
      fabricData = await extractFabricComposition(scrapedData.content)
    }

    console.log('[Analysis Complete]', fabricData)

    // Step 4: Save to cache for future lookups
    await saveToCache(url, fabricData)

    // Step 5: Generate Amazon alternatives
    const brand = extractBrand(url)
    const alternatives = generateAmazonAlternatives(fabricData, brand, 'athletic wear')

    // Return results
    res.json({
      ...fabricData,
      alternatives,
      brand,
      cached: false
    })

  } catch (error) {
    console.error('[API Error]:', error)
    res.status(500).json({ error: error.message || 'Analysis failed' })
  }
})

// Generate Amazon search URLs with affiliate links
function generateAmazonAlternatives(fabricData, brand, productType = 'leggings') {
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG

  if (!associateTag) {
    console.warn('[Amazon] No associate tag configured')
    return []
  }

  // Build search keywords based on fabric composition
  const fabricComposition = fabricData.fabrics
    .map(f => `${f.percentage}% ${f.type}`)
    .join(' ')

  const mainFabric = fabricData.fabrics[0]?.type || ''
  const qualityTier = fabricData.quality_tier || 'athletic'

  // Generate multiple search strategies
  const searches = [
    {
      query: `${productType} ${fabricComposition}`,
      category: 'Exact Fabric Match',
      description: `${productType.charAt(0).toUpperCase() + productType.slice(1)} with ${fabricComposition}`
    },
    {
      query: `${mainFabric} ${productType} ${qualityTier}`,
      category: 'Main Fabric Match',
      description: `${mainFabric} ${productType} - similar quality`
    },
    {
      query: `budget ${mainFabric} ${productType}`,
      category: 'Budget Alternative',
      description: `Budget ${mainFabric} ${productType}`
    }
  ]

  // Convert to Amazon affiliate links
  return searches.map(search => ({
    ...search,
    url: `https://www.amazon.com/s?k=${encodeURIComponent(search.query)}&tag=${associateTag}`,
    estimatedSavings: '40-60%' // Typical savings vs premium brands
  }))
}

// API route to get Amazon alternatives
app.post('/api/alternatives', async (req, res) => {
  try {
    const { fabrics, quality_tier, features, brand, productType } = req.body

    if (!fabrics || !Array.isArray(fabrics)) {
      return res.status(400).json({ error: 'Fabric data is required' })
    }

    const alternatives = generateAmazonAlternatives(
      { fabrics, quality_tier, features },
      brand,
      productType || 'leggings'
    )

    res.json({ alternatives })
  } catch (error) {
    console.error('[Alternatives API Error]:', error)
    res.status(500).json({ error: 'Failed to generate alternatives' })
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

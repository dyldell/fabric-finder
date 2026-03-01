import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { createClient } from '@supabase/supabase-js'
import SerpApi from 'google-search-results-nodejs'

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
        product_name: fabricData.product_name || null,
        product_type: fabricData.product_type || null,
        gender: fabricData.gender || null,
        product_image: fabricData.product_image || null,
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
          prompt: 'Extract product data from this page. CRITICAL: For fabric composition, extract ONLY the main body fabric - IGNORE pocket lining, trim, or waistband fabrics. If you see "Body:" or "Main fabric:" labels, extract the fabrics listed after that label. NEVER use "Body", "Pocket", "Lining" as fabric types - only extract actual materials like Nylon, Polyester, Spandex, Lycra Elastane, Cotton, etc. Also extract product type (shirt, pants, leggings, etc.) and gender (mens, womens, unisex).',
          schema: {
            type: 'object',
            properties: {
              product_name: { type: 'string' },
              product_type: { type: 'string' },
              gender: { type: 'string' },
              product_image: { type: 'string' },
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
  const prompt = `You are a fabric composition analyzer. Analyze the following product page content and extract the MAIN BODY fabric composition only.

CRITICAL RULES:
1. Extract ONLY the main body/garment fabric - IGNORE pocket lining, trim, waistband, or any secondary fabrics
2. If you see "Body:" or "Main fabric:" labels, extract the fabrics listed AFTER that label
3. NEVER use "Body", "Pocket", "Lining", "Trim" as fabric types - these are LABELS not fabrics
4. Only extract actual fabric materials like: Nylon, Polyester, Spandex, Lycra, Elastane, Cotton, etc.
5. Return fabric percentages as numbers (e.g., 71 not "71%")
6. Extract the product type (shirt, pants, leggings, shorts, jacket, bra, tank, tee, etc.)
7. Extract the gender (mens, womens, unisex)
8. Extract the main product image URL if available

Example:
If you see "Pocket Lining: 90% Polyester, 10% Lycra | Body: 71% Nylon, 29% Lycra Elastane"
Extract ONLY: [{"type": "Nylon", "percentage": 71}, {"type": "Lycra Elastane", "percentage": 29}]

Return ONLY a valid JSON object with this exact structure:
{
  "product_name": "Pace Breaker Short",
  "product_type": "shorts",
  "gender": "mens",
  "product_image": "https://...",
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
      const alternatives = await searchProductAlternatives(
        {
          fabrics: cachedData.fabrics,
          quality_tier: cachedData.quality_tier,
          features: cachedData.features,
          product_type: cachedData.product_type,
          gender: cachedData.gender
        },
        cachedData.brand,
        cachedData.product_type || 'athletic wear'
      )

      return res.json({
        product_name: cachedData.product_name,
        product_type: cachedData.product_type,
        gender: cachedData.gender,
        product_image: cachedData.product_image,
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

    // Step 5: Search for real product alternatives
    const brand = extractBrand(url)
    const alternatives = await searchProductAlternatives(
      fabricData,
      brand,
      fabricData.product_type || 'athletic wear'
    )

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

// Search for real product alternatives using SerpAPI
async function searchProductAlternatives(fabricData, brand, productType = 'athletic wear') {
  const serpApiKey = process.env.SERP_API_KEY
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG

  if (!serpApiKey) {
    console.warn('[SerpAPI] No API key configured - using fallback')
    return generateFallbackAlternatives(fabricData, brand, productType)
  }

  try {
    // Build search query based on product type, gender, and fabric composition
    const mainFabric = fabricData.fabrics[0]?.type || 'synthetic'
    const secondaryFabric = fabricData.fabrics[1]?.type || ''

    // Use extracted product type and gender, or fall back to generic
    const gender = fabricData.gender || ''
    let type = fabricData.product_type || productType

    // Expand product type aliases for better search results
    const typeExpansions = {
      'tee': 't-shirt',
      'top': 'shirt',
      'pant': 'pants',
      'tight': 'leggings'
    }
    const expandedType = typeExpansions[type] || type

    // Create smart search query with gender + expanded type
    let searchQuery = ''
    if (gender && expandedType) {
      // "mens t-shirt polyester spandex"
      searchQuery = secondaryFabric
        ? `${gender} ${expandedType} ${mainFabric} ${secondaryFabric}`
        : `${gender} ${expandedType} ${mainFabric}`
    } else if (expandedType) {
      // "t-shirt polyester spandex"
      searchQuery = secondaryFabric
        ? `${expandedType} ${mainFabric} ${secondaryFabric}`
        : `${expandedType} ${mainFabric}`
    } else {
      // fallback to generic
      searchQuery = secondaryFabric
        ? `${mainFabric} ${secondaryFabric} athletic wear`
        : `${mainFabric} athletic wear`
    }

    console.log(`[SerpAPI] Searching for: "${searchQuery}" (type: ${type})`)

    // Call SerpAPI Google Shopping
    const search = new SerpApi.GoogleSearch(serpApiKey)

    const results = await new Promise((resolve, reject) => {
      search.json({
        engine: 'google_shopping',
        q: searchQuery,
        num: 6, // Get top 6 results
        gl: 'us', // United States
        hl: 'en', // English
      }, (data) => {
        resolve(data)
      })
    })

    if (!results.shopping_results || results.shopping_results.length === 0) {
      console.warn('[SerpAPI] No shopping results found')
      return generateFallbackAlternatives(fabricData, brand, productType)
    }

    console.log(`[SerpAPI] Found ${results.shopping_results.length} products`)

    // Filter results by product type to avoid irrelevant matches
    let filteredResults = results.shopping_results

    // Define exclusion lists for different product types
    const typeExclusions = {
      'shirt': ['legging', 'pant', 'short', 'jogger', 'tight', 'capri'],
      't-shirt': ['legging', 'pant', 'short', 'jogger', 'tight', 'capri'],
      'tee': ['legging', 'pant', 'short', 'jogger', 'tight', 'capri'],
      'top': ['legging', 'pant', 'short', 'jogger', 'tight', 'capri'],
      'tank': ['legging', 'pant', 'short', 'jogger', 'tight', 'capri'],
      'leggings': ['shirt', 't-shirt', 'tee', 'top', 'tank', 'jacket', 'hoodie'],
      'pants': ['shirt', 't-shirt', 'tee', 'top', 'tank', 'jacket', 'hoodie'],
      'shorts': ['shirt', 't-shirt', 'tee', 'top', 'tank', 'jacket', 'hoodie', 'legging', 'pant'],
      'jacket': ['legging', 'pant', 'short', 'jogger', 'tight'],
      'hoodie': ['legging', 'pant', 'short', 'jogger', 'tight']
    }

    const productType = fabricData.product_type || productType
    const exclusions = typeExclusions[productType] || []

    if (exclusions.length > 0) {
      filteredResults = results.shopping_results.filter(product => {
        const title = (product.title || '').toLowerCase()
        return !exclusions.some(excluded => title.includes(excluded))
      })
      console.log(`[SerpAPI] Filtered ${results.shopping_results.length} → ${filteredResults.length} products (excluded: ${exclusions.join(', ')})`)
    }

    // Transform SerpAPI results into our format (get top 6 after filtering)
    return filteredResults.slice(0, 6).map(product => {
      // Add Amazon affiliate tag if it's an Amazon product
      let productUrl = product.product_link || product.link || '#'
      if (productUrl && productUrl.includes('amazon.com') && associateTag) {
        try {
          const urlObj = new URL(productUrl)
          urlObj.searchParams.set('tag', associateTag)
          productUrl = urlObj.toString()
        } catch (e) {
          console.warn('[SerpAPI] Invalid product URL:', productUrl)
        }
      }

      return {
        title: product.title || 'Product',
        price: product.price || 'Price not available',
        originalPrice: product.extracted_price || null,
        image: product.thumbnail || null,
        url: productUrl,
        source: product.source || 'Unknown',
        rating: product.rating || null,
        reviews: product.reviews || null,
        delivery: product.delivery || null,
      }
    })

  } catch (error) {
    console.error('[SerpAPI Error]:', error.message)
    return generateFallbackAlternatives(fabricData, brand, productType)
  }
}

// Fallback: Generate basic Amazon search links if SerpAPI fails
function generateFallbackAlternatives(fabricData, brand, productType = 'athletic wear') {
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG || 'fabricfinder-20'

  const fabricComposition = fabricData.fabrics
    .map(f => `${f.percentage}% ${f.type}`)
    .join(' ')

  const mainFabric = fabricData.fabrics[0]?.type || ''

  return [
    {
      title: `${mainFabric} ${productType} - Exact Fabric Match`,
      price: 'Search on Amazon',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(`${productType} ${fabricComposition}`)}&tag=${associateTag}`,
      image: null,
      source: 'Amazon Search',
      estimatedSavings: '40-60%'
    },
    {
      title: `Budget ${mainFabric} ${productType}`,
      price: 'Search on Amazon',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(`budget ${mainFabric} ${productType}`)}&tag=${associateTag}`,
      image: null,
      source: 'Amazon Search',
      estimatedSavings: '50-70%'
    }
  ]
}

// API route to get product alternatives
app.post('/api/alternatives', async (req, res) => {
  try {
    const { fabrics, quality_tier, features, brand, productType } = req.body

    if (!fabrics || !Array.isArray(fabrics)) {
      return res.status(400).json({ error: 'Fabric data is required' })
    }

    const alternatives = await searchProductAlternatives(
      { fabrics, quality_tier, features },
      brand,
      productType || 'athletic wear'
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

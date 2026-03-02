import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { createClient } from '@supabase/supabase-js'
import SerpApi from 'google-search-results-nodejs'
import amazonPaapi from 'amazon-paapi'
import { trackApiCall, printApiSummary } from '../dashboard/tracker.js'

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
async function checkCache(url, forceRefresh = false) {
  if (forceRefresh) {
    console.log('[Cache] Force refresh requested - skipping cache')
    return null
  }

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

    // Check if cache has expired (7 days default)
    const expiresAt = new Date(data.expires_at)
    const now = new Date()

    if (expiresAt < now) {
      console.log('[Cache] Expired - Last cached:', data.scraped_at)
      return null
    }

    // Update cache hit counter
    await supabase
      .from('products_cache')
      .update({ cache_hits: (data.cache_hits || 0) + 1 })
      .eq('id', data.id)

    const cacheAge = Math.floor((now - new Date(data.scraped_at)) / (1000 * 60 * 60 * 24))
    console.log(`[Cache] Hit - Cached ${cacheAge} days ago (${data.cache_hits || 0} hits)`)

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

  // Set expiration: 7 days for product data (prices change)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days

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
        expires_at: expiresAt.toISOString(),
        scrape_success: true,
        cache_hits: 0
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
  const needsStealth = useJsonExtraction || url.includes('patagonia.com') || url.includes('abercrombie.com')

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
    const { url, refresh } = req.body

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

    console.log(`\n[Analysis Started] URL: ${url}${refresh ? ' (FORCE REFRESH)' : ''}`)

    // Track scan start time for total timing
    const scanStartTime = Date.now()
    const apiCallTracker = { firecrawl: 0, claude: 0, serpapi: 0 }

    // CACHE DISABLED FOR TESTING - Re-enable later
    // Step 1: Check cache first (HYBRID SYSTEM)
    // const cachedData = await checkCache(url, refresh === true)
    //
    // if (cachedData) {
    //   console.log('[Cache] Returning cached result ⚡')
    //
    //   // Generate alternatives even for cached results
    //   const alternatives = await searchProductAlternatives(
    //     {
    //       fabrics: cachedData.fabrics,
    //       quality_tier: cachedData.quality_tier,
    //       features: cachedData.features,
    //       product_type: cachedData.product_type,
    //       gender: cachedData.gender
    //     },
    //     cachedData.brand,
    //     cachedData.product_type || 'athletic wear'
    //   )
    //
    //   return res.json({
    //     product_name: cachedData.product_name,
    //     product_type: cachedData.product_type,
    //     gender: cachedData.gender,
    //     product_image: cachedData.product_image,
    //     fabrics: cachedData.fabrics,
    //     quality_tier: cachedData.quality_tier,
    //     features: cachedData.features,
    //     alternatives,
    //     brand: cachedData.brand,
    //     cached: true,
    //     cached_at: cachedData.scraped_at
    //   })
    // }

    // Step 2: Scrape with Firecrawl (cache disabled)
    console.log('[Scraping] Fresh scrape - cache disabled for testing')
    const firecrawlStart = Date.now()
    const scrapedData = await scrapeWithFirecrawl(url)
    const firecrawlTime = Date.now() - firecrawlStart

    if (!scrapedData.success) {
      // Track failed Firecrawl call
      await trackApiCall('firecrawl', {
        scanUrl: url,
        responseTime: firecrawlTime,
        status: 'error'
      })
      return res.status(500).json({
        error: 'Failed to scrape product page',
        details: scrapedData.error
      })
    }

    // Track successful Firecrawl call
    await trackApiCall('firecrawl', {
      scanUrl: url,
      responseTime: firecrawlTime,
      status: 'success'
    })
    apiCallTracker.firecrawl = 1

    // Step 3: Extract fabric composition
    let fabricData

    if (scrapedData.fabricData) {
      // JSON extraction already provided the data (Alo Yoga)
      console.log('[Analysis] Using JSON-extracted data')
      fabricData = scrapedData.fabricData
    } else {
      // Use Claude API to extract from markdown content
      console.log('[Analysis] Extracting with Claude API')
      const claudeStart = Date.now()
      fabricData = await extractFabricComposition(scrapedData.content)
      const claudeTime = Date.now() - claudeStart

      // Track Claude call
      await trackApiCall('claude', {
        scanUrl: url,
        responseTime: claudeTime,
        status: 'success'
      })
      apiCallTracker.claude++
    }

    console.log('[Analysis Complete]', fabricData)

    // CACHE DISABLED FOR TESTING - Re-enable later
    // Step 4: Save to cache for future lookups
    // await saveToCache(url, fabricData)

    // Step 5: Search for real product alternatives
    const brand = extractBrand(url)
    const searchStart = Date.now()
    const alternatives = await searchProductAlternatives(
      fabricData,
      brand,
      fabricData.product_type || 'athletic wear'
    )
    const searchTime = Date.now() - searchStart

    // Track SerpAPI calls (5 total: 2 Amazon + 3 Google Shopping)
    await trackApiCall('serpapi', {
      scanUrl: url,
      callCount: 5,
      responseTime: searchTime,
      status: 'success'
    })
    apiCallTracker.serpapi = 5

    // Track Claude scoring call (happens inside searchProductAlternatives)
    await trackApiCall('claude', {
      scanUrl: url,
      callCount: 1,
      responseTime: searchTime,
      status: 'success',
      metadata: { purpose: 'product_scoring' }
    })
    apiCallTracker.claude++

    // Calculate total cost and print summary
    const totalCost = (
      (apiCallTracker.firecrawl * 0.015) +
      (apiCallTracker.claude * 0.0075) +
      (apiCallTracker.serpapi * 0.0036)
    )

    const totalTime = Date.now() - scanStartTime

    printApiSummary({
      claudeCalls: apiCallTracker.claude,
      serpapiCalls: apiCallTracker.serpapi,
      firecrawlCalls: apiCallTracker.firecrawl,
      totalCost,
      scanTime: totalTime
    })

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

// Search for real product alternatives using SerpAPI (keep for Google Shopping results)
async function searchSerpApiProducts(fabricData, brand, productType = 'athletic wear', customQuery = null) {
  const serpApiKey = process.env.SERP_API_KEY
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG

  if (!serpApiKey) {
    console.warn('[SerpAPI] No API key configured - using fallback')
    return []
  }

  try {
    let searchQuery = ''

    // Use custom query if provided (for multi-query strategy)
    if (customQuery) {
      searchQuery = customQuery
    } else {
      // Build default search query based on product type, gender, and fabric composition
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
      let expandedType = typeExpansions[type] || type

      // Women's "pants" in athletic context = leggings
      if (gender === 'womens' && (type === 'pants' || type === 'pant')) {
        expandedType = 'leggings'
      }

      // Create smart search query with gender + expanded type
      if (gender && expandedType) {
        searchQuery = secondaryFabric
          ? `${gender} ${expandedType} ${mainFabric} ${secondaryFabric}`
          : `${gender} ${expandedType} ${mainFabric}`
      } else if (expandedType) {
        searchQuery = secondaryFabric
          ? `${expandedType} ${mainFabric} ${secondaryFabric}`
          : `${expandedType} ${mainFabric}`
      } else {
        searchQuery = secondaryFabric
          ? `${mainFabric} ${secondaryFabric} athletic wear`
          : `${mainFabric} athletic wear`
      }
    }

    console.log(`[SerpAPI] Searching: "${searchQuery}"`)

    // Call SerpAPI Google Shopping
    const search = new SerpApi.GoogleSearch(serpApiKey)

    const results = await new Promise((resolve, reject) => {
      search.json({
        engine: 'google_shopping',
        q: searchQuery,
        num: 20, // Get top 20 results per query (more chances to find exact matches)
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

    const currentProductType = fabricData.product_type || productType
    const exclusions = typeExclusions[currentProductType] || []

    if (exclusions.length > 0) {
      filteredResults = results.shopping_results.filter(product => {
        const title = (product.title || '').toLowerCase()
        return !exclusions.some(excluded => title.includes(excluded))
      })
      console.log(`[SerpAPI] Filtered ${results.shopping_results.length} → ${filteredResults.length} products (excluded: ${exclusions.join(', ')})`)
    }

    // Transform SerpAPI results into our format (get top 20 after filtering for better matches)
    return filteredResults.slice(0, 20).map(product => {
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

// Search Amazon directly using SerpAPI (no Creator API needed!)
async function searchAmazonViaSerpApi(fabricData, brand, productType = 'athletic wear', customQuery = null) {
  const serpApiKey = process.env.SERP_API_KEY
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG || 'fabricfinder-20'

  if (!serpApiKey) {
    console.warn('[SerpAPI Amazon] No API key configured')
    return []
  }

  try {
    // Use custom query or build from fabric data
    const searchQuery = customQuery || (() => {
      const gender = fabricData.gender || ''
      const type = fabricData.product_type || productType
      const fabricString = fabricData.fabrics
        .map(f => `${f.percentage}% ${f.type}`)
        .join(' ')

      return gender && type
        ? `${gender} ${type} ${fabricString}`
        : `${type} ${fabricString}`
    })()

    console.log(`[SerpAPI Amazon] Searching: "${searchQuery}"`)

    const search = new SerpApi.GoogleSearch(serpApiKey)

    const results = await new Promise((resolve, reject) => {
      search.json({
        engine: 'amazon',
        amazon_domain: 'amazon.com',
        k: searchQuery,
        page: 1
      }, (data) => {
        resolve(data)
      })
    })

    if (!results.organic_results || results.organic_results.length === 0) {
      console.warn('[SerpAPI Amazon] No results found')
      return []
    }

    console.log(`[SerpAPI Amazon] Found ${results.organic_results.length} Amazon products`)

    // Transform Amazon results (get top 20 for better match coverage)
    return results.organic_results.slice(0, 20).map(product => {
      // Add affiliate tag to Amazon URL
      let productUrl = product.link || '#'
      if (productUrl.includes('amazon.com')) {
        try {
          const urlObj = new URL(productUrl)
          urlObj.searchParams.set('tag', associateTag)
          productUrl = urlObj.toString()
        } catch (e) {
          console.warn('[SerpAPI Amazon] Invalid URL:', productUrl)
        }
      }

      return {
        title: product.title || 'Amazon Product',
        price: product.price || 'Price not available',
        originalPrice: null,
        image: product.thumbnail || null,
        url: productUrl,
        source: 'Amazon',
        rating: product.rating || null,
        reviews: product.reviews || null,
        asin: product.asin || null
      }
    })

  } catch (error) {
    console.error('[SerpAPI Amazon Error]:', error.message)
    return []
  }
}

// MAIN FUNCTION: Combine Amazon + Multi-Query SerpAPI and rank with Claude
async function searchProductAlternatives(fabricData, brand, productType = 'athletic wear') {
  console.log('[Search] Starting multi-query search strategy')

  const gender = fabricData.gender || ''
  let type = fabricData.product_type || productType

  // Women's "pants" in athletic context = leggings
  if (gender === 'womens' && (type === 'pants' || type === 'pant')) {
    type = 'leggings'
  }

  // Get fabric with all alternate names for comprehensive search
  const getFabricWithAlternates = (fabricType) => {
    // First normalize brand names to generic terms
    const normalizations = {
      'Lycra Elastane': 'Elastane',
      'Lycra': 'Elastane'
    }
    const normalized = normalizations[fabricType] || fabricType

    // Then add all alternate names
    const synonyms = {
      'Elastane': 'Elastane Spandex',  // Include both terms
      'Spandex': 'Elastane Spandex',
      'Nylon': 'Nylon Polyamide',
      'Polyamide': 'Nylon Polyamide',
      'Rayon': 'Rayon Viscose',
      'Viscose': 'Rayon Viscose',
      'Polyurethane': 'Polyurethane PU',
      'PU': 'Polyurethane PU'
    }

    return synonyms[normalized] || normalized
  }

  // Build fabric string with percentages and alternate names
  // e.g., "96% Polyester 4% Elastane Spandex" (searches for both Elastane AND Spandex)
  const fabricString = fabricData.fabrics
    .map(f => `${f.percentage}% ${getFabricWithAlternates(f.type)}`)
    .join(' ')

  // Build 3 different search queries to maximize coverage
  const queries = []

  // Query 1: Budget-focused (likely to find Amazon)
  queries.push({
    name: 'budget',
    query: gender && type
      ? `budget ${gender} ${type} ${fabricString}`
      : `budget ${type} ${fabricString}`
  })

  // Query 2: Exact match (current strategy)
  queries.push({
    name: 'exact',
    query: gender && type
      ? `${gender} ${type} ${fabricString}`
      : `${type} ${fabricString}`
  })

  // Query 3: Value/affordable (catches different retailers)
  queries.push({
    name: 'affordable',
    query: gender && type
      ? `affordable ${gender} ${type} ${fabricString}`
      : `affordable ${type} ${fabricString}`
  })

  console.log(`[Search] Running searches: Amazon direct + Google Shopping (3 queries each)`)

  // Run all queries in parallel: Amazon PAAPI, Amazon SerpAPI (2 queries), Google Shopping SerpAPI (3 queries)
  const [amazonPaapiResults, amazonSerpExact, amazonSerpBudget, ...googleShoppingResults] = await Promise.all([
    searchAmazonProducts(fabricData, brand, productType),
    searchAmazonViaSerpApi(fabricData, brand, productType, queries.find(q => q.name === 'exact').query),
    searchAmazonViaSerpApi(fabricData, brand, productType, queries.find(q => q.name === 'budget').query),
    ...queries.map(q => searchSerpApiProducts(fabricData, brand, productType, q.query))
  ])

  // Combine all Amazon results (PAAPI + SerpAPI)
  const allAmazonResults = [...amazonPaapiResults, ...amazonSerpExact, ...amazonSerpBudget]

  // Flatten Google Shopping results
  const allGoogleShoppingResults = googleShoppingResults.flat()

  // Combine everything
  const allResults = [...allAmazonResults, ...allGoogleShoppingResults]

  // Deduplicate by URL AND title similarity (catch variants of same product)
  const seenUrls = new Set()
  const seenTitles = new Map() // title -> product
  const deduplicatedResults = allResults.filter(product => {
    // Skip if exact URL match
    if (seenUrls.has(product.url)) return false

    // Check for similar titles (same source + similar title = duplicate)
    const titleKey = `${product.source}:${product.title?.substring(0, 30)}`
    if (seenTitles.has(titleKey)) return false

    seenUrls.add(product.url)
    seenTitles.set(titleKey, product)
    return true
  })

  // Use deduplicated results
  let allProducts = deduplicatedResults

  if (allProducts.length === 0) {
    console.warn('[Search] No results from any source - using fallback')
    return generateFallbackAlternatives(fabricData, brand, productType)
  }

  console.log(`[Search] Found ${allAmazonResults.length} Amazon + ${allGoogleShoppingResults.length} Google Shopping = ${allResults.length} total → ${allProducts.length} unique products after deduplication`)

  // Use Claude to score and rank all products by fabric match
  let rankedProducts = await scoreAndRankProducts(
    fabricData.fabrics,
    allProducts,
    fabricData.product_type || productType
  )

  // Sort by match percentage ONLY (highest first)
  rankedProducts.sort((a, b) => b.matchPercentage - a.matchPercentage)

  console.log(`[Search] Sorted by fabric match % only`)

  // Log final top 10 (sorted by fabric match % only)
  console.log('\n[Final Top 10 - By Fabric Match]:')
  rankedProducts.slice(0, 10).forEach((p, i) => {
    console.log(`${i + 1}. [${p.matchPercentage}%] ${p.price} - ${p.title.substring(0, 60)}... (${p.source})`)
  })
  console.log('')

  // Return top 10 products
  return rankedProducts.slice(0, 10)
}

// Helper: Extract numeric price from string
function extractPrice(priceString) {
  if (!priceString || typeof priceString !== 'string') return 999999
  const match = priceString.match(/[\d,]+\.?\d*/);
  if (!match) return 999999
  return parseFloat(match[0].replace(/,/g, ''))
}

// Search Amazon using Product Advertising API
async function searchAmazonProducts(fabricData, brand, productType = 'athletic wear') {
  const accessKey = process.env.AMAZON_ACCESS_KEY
  const secretKey = process.env.AMAZON_SECRET_KEY
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG

  if (!accessKey || !secretKey || !associateTag) {
    console.warn('[Amazon PAAPI] API credentials not configured')
    return []
  }

  try {
    // Build search keywords
    const gender = fabricData.gender || ''
    const type = fabricData.product_type || productType
    const mainFabric = fabricData.fabrics[0]?.type || ''

    const searchKeywords = gender && type
      ? `${gender} ${type} ${mainFabric}`
      : `${type} ${mainFabric}`

    console.log(`[Amazon PAAPI] Searching for: "${searchKeywords}"`)

    const requestParameters = {
      Keywords: searchKeywords,
      SearchIndex: 'Fashion',
      ItemCount: 10,
      Resources: [
        'Images.Primary.Large',
        'ItemInfo.Title',
        'ItemInfo.Features',
        'Offers.Listings.Price',
        'Offers.Listings.SavingBasis'
      ]
    }

    const commonParameters = {
      AccessKey: accessKey,
      SecretKey: secretKey,
      PartnerTag: associateTag,
      PartnerType: 'Associates',
      Marketplace: 'www.amazon.com'
    }

    const data = await amazonPaapi.SearchItems(commonParameters, requestParameters)

    if (!data.SearchResult || !data.SearchResult.Items) {
      console.warn('[Amazon PAAPI] No items found')
      return []
    }

    console.log(`[Amazon PAAPI] Found ${data.SearchResult.Items.length} products`)

    // Transform Amazon results
    return data.SearchResult.Items.map(item => {
      const price = item.Offers?.Listings?.[0]?.Price?.DisplayAmount || null
      const image = item.Images?.Primary?.Large?.URL || null

      return {
        title: item.ItemInfo?.Title?.DisplayValue || 'Amazon Product',
        price: price,
        originalPrice: null,
        image: image,
        url: item.DetailPageURL || '#',
        source: 'Amazon',
        rating: null,
        reviews: null,
        delivery: null,
        asin: item.ASIN,
        features: item.ItemInfo?.Features?.DisplayValues || []
      }
    })

  } catch (error) {
    console.error('[Amazon PAAPI Error]:', error.message)
    return []
  }
}

// Use Claude to calculate match percentage and rank results
async function scoreAndRankProducts(originalFabrics, products, productType) {
  if (products.length === 0) return []

  try {
    // Build fabric comparison prompt
    const originalFabricString = originalFabrics
      .map(f => `${f.percentage}% ${f.type}`)
      .join(', ')

    const productsJson = JSON.stringify(products.map((p, idx) => ({
      index: idx,
      title: p.title,
      source: p.source,
      features: p.features || []
    })))

    const prompt = `You are a fabric matching expert. The user is looking for products similar to one with this fabric composition:
"${originalFabricString}"

Product type: ${productType}

Here are candidate products to rank:
${productsJson}

For each product, analyze the title and features to estimate the fabric composition match percentage.

IMPORTANT SCORING GUIDELINES for Polyester/Elastane (Spandex) blends:
- Products with "Performance", "Moisture Wicking", "Tech", "Athletic", "Dry Fit", "Quick Dry", "UPF" are HIGHLY LIKELY to be polyester/elastane blends
- These keywords indicate 90-100% match for polyester/elastane searches
- "odSTRATUM", "Cool Dri", "Dri-Power", brand names suggest high-performance polyester blends

Scoring rubric:
- 95-100% = Has 3+ performance keywords (Performance, Moisture Wicking, Tech, UPF, Quick Dry, Athletic)
- 90-94% = Has 2 performance keywords
- 85-89% = Has 1 performance keyword or "workout/gym/running" in title
- 80-84% = Generic athletic wear without specific performance features
- 70-79% = Similar fabric type (e.g., polyester vs nylon)
- <70% = Poor match

Return ONLY a JSON array with this structure:
[
  {"index": 0, "matchPercentage": 98, "reason": "Performance + Moisture Wicking + Tech + UPF indicates polyester/elastane blend"},
  {"index": 1, "matchPercentage": 85, "reason": "Athletic tee, likely synthetic blend"}
]`

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: prompt
      }]
    })

    let responseText = message.content[0].text
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()

    const scores = JSON.parse(responseText)

    // Add match data to products and sort by match percentage
    const scoredProducts = products.map((product, idx) => {
      const score = scores.find(s => s.index === idx)
      return {
        ...product,
        matchPercentage: score?.matchPercentage || 50,
        matchReason: score?.reason || 'Unable to determine match'
      }
    })

    // Sort by match percentage (highest first)
    scoredProducts.sort((a, b) => b.matchPercentage - a.matchPercentage)

    console.log(`[Claude Matching] Scored and ranked ${scoredProducts.length} products`)

    // Log top 15 products for debugging
    console.log('\n[Top 15 Products After Scoring]:')
    scoredProducts.slice(0, 15).forEach((p, i) => {
      console.log(`${i + 1}. [${p.matchPercentage}%] ${p.title.substring(0, 80)}... (${p.source})`)
    })
    console.log('')

    return scoredProducts

  } catch (error) {
    console.error('[Claude Matching Error]:', error.message)
    // Return products with default 50% match if scoring fails
    return products.map(p => ({
      ...p,
      matchPercentage: 50,
      matchReason: 'Match scoring unavailable'
    }))
  }
}

// Fallback: Generate basic Amazon search links if both APIs fail
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
      matchPercentage: 75,
      matchReason: 'Generic fabric search'
    },
    {
      title: `Budget ${mainFabric} ${productType}`,
      price: 'Search on Amazon',
      url: `https://www.amazon.com/s?k=${encodeURIComponent(`budget ${mainFabric} ${productType}`)}&tag=${associateTag}`,
      image: null,
      source: 'Amazon Search',
      matchPercentage: 65,
      matchReason: 'Budget alternative search'
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

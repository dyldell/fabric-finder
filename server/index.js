import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { createClient } from '@supabase/supabase-js'
import SerpApi from 'google-search-results-nodejs'
import amazonPaapi from 'amazon-paapi'
import { trackApiCall, printApiSummary, getTodaysCost } from '../dashboard/tracker.js'
import {
  ALLOWED_ORIGINS,
  RATE_LIMITS,
  HELMET_CONFIG,
  MAX_REQUEST_SIZE,
  DAILY_COST_LIMIT,
  isValidScrapeUrl,
  sanitizeError
} from './security-config.js'
import { isValidAdminKey } from './admin-config.js'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3000

// ============================================================================
// SECURITY MIDDLEWARE
// ============================================================================

// 1. Security headers (helmet)
app.use(helmet(HELMET_CONFIG))

// 2. Request size limit (DoS prevention)
app.use(express.json({ limit: MAX_REQUEST_SIZE }))

// 3. Cookie parser (for admin sessions)
app.use(cookieParser())

// 4. Gzip compression
app.use(compression())

// 5. CORS whitelist
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true)

    if (ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true)
    } else {
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true  // Allow cookies to be sent
}))

// 6. HTTPS enforcement (production only)
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.headers['x-forwarded-proto'] !== 'https') {
      return res.redirect(301, `https://${req.headers.host}${req.url}`)
    }
    next()
  })
}

// ============================================================================
// RATE LIMITING
// ============================================================================

// Dual rate limiting: both burst (15min) and hourly limits
// Free users must pass BOTH limiters
// Admin users bypass all rate limits

/**
 * Skip rate limiting for admin users
 * Checks for admin_session cookie
 */
const skipAdminRateLimit = (req, res) => {
  return req.cookies.admin_session === 'true'
}

// Burst protection: 10 requests per 15 minutes
const burstLimiter = rateLimit({
  windowMs: RATE_LIMITS.freeBurst.windowMs,
  max: RATE_LIMITS.freeBurst.max,
  message: RATE_LIMITS.freeBurst.message,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAdminRateLimit
})

// Hourly limit: 20 requests per hour
const hourlyLimiter = rateLimit({
  windowMs: RATE_LIMITS.freeHourly.windowMs,
  max: RATE_LIMITS.freeHourly.max,
  message: RATE_LIMITS.freeHourly.message,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipAdminRateLimit
})

// ============================================================================
// VALIDATION MIDDLEWARE
// ============================================================================

/**
 * Validates product URL before processing
 * Prevents SSRF attacks by checking domain allowlist and blocking internal IPs
 */
function validateUrl(req, res, next) {
  const { url } = req.body

  if (!url) {
    return res.status(400).json({
      error: 'URL is required',
      message: 'Please provide a product URL to analyze.'
    })
  }

  const validation = isValidScrapeUrl(url)
  if (!validation.valid) {
    return res.status(400).json({
      error: 'Invalid URL',
      message: validation.error
    })
  }

  next()
}

/**
 * Cost monitoring kill switch
 * Blocks requests if daily cost limit is exceeded ($50/day)
 */
async function checkCostLimit(req, res, next) {
  try {
    const todaysCost = await getTodaysCost()

    if (todaysCost >= DAILY_COST_LIMIT) {
      console.error(`[COST ALERT] Daily limit exceeded: $${todaysCost.toFixed(2)}`)
      return res.status(503).json({
        error: 'Service temporarily unavailable',
        message: 'Our service is currently at capacity. Please try again later.'
      })
    }

    next()
  } catch (error) {
    // Don't block request if cost check fails
    console.error('[Cost Check] Failed to check cost limit:', error.message)
    next()
  }
}

// ============================================================================
// USER SCAN TRACKING (Anonymous)
// ============================================================================

const MAX_FREE_SCANS = 3

/**
 * Get current month identifier (YYYY-MM)
 */
function getCurrentMonth() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Check if user is admin (whitelisted)
 */
async function isAdminUser(userId) {
  try {
    const { data, error } = await supabase
      .from('admin_users')
      .select('user_id')
      .eq('user_id', userId)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found
      console.error('[Admin Check Error]:', error)
      return false
    }

    return !!data
  } catch (error) {
    console.error('[Admin Check Error]:', error)
    return false
  }
}

/**
 * Get user scan count for current month
 */
async function getUserScanCount(userId, fingerprint) {
  try {
    const currentMonth = getCurrentMonth()

    // Try to find by userId first
    let { data, error } = await supabase
      .from('user_scans')
      .select('scan_count')
      .eq('user_id', userId)
      .eq('scan_month', currentMonth)
      .single()

    // If not found by userId, try fingerprint (backup for users who cleared cookies)
    if ((error && error.code === 'PGRST116') && fingerprint) {
      const fpResult = await supabase
        .from('user_scans')
        .select('scan_count, user_id')
        .eq('fingerprint', fingerprint)
        .eq('scan_month', currentMonth)
        .single()

      if (fpResult.data) {
        console.log('[Scan Tracking] Found user by fingerprint, updating userId')
        // Update the record with the new userId
        await supabase
          .from('user_scans')
          .update({ user_id: userId })
          .eq('fingerprint', fingerprint)
          .eq('scan_month', currentMonth)

        data = fpResult.data
        error = fpResult.error
      }
    }

    if (error && error.code !== 'PGRST116') {
      console.error('[Scan Count Error]:', error)
      return 0
    }

    return data ? data.scan_count : 0
  } catch (error) {
    console.error('[Scan Count Error]:', error)
    return 0
  }
}

/**
 * Increment user scan count
 */
async function incrementUserScanCount(userId, fingerprint) {
  try {
    const currentMonth = getCurrentMonth()

    // Upsert: increment if exists, create if not
    const { error } = await supabase
      .from('user_scans')
      .upsert(
        {
          user_id: userId,
          fingerprint: fingerprint,
          scan_month: currentMonth,
          scan_count: 1,
          last_scan_at: new Date().toISOString()
        },
        {
          onConflict: 'user_id,scan_month',
          ignoreDuplicates: false
        }
      )
      .select()

    // If upsert didn't work (record exists), increment manually
    if (error || !error) {
      await supabase.rpc('increment_scan_count', {
        p_user_id: userId,
        p_scan_month: currentMonth,
        p_fingerprint: fingerprint
      }).catch(async () => {
        // Fallback: manual increment
        const currentCount = await getUserScanCount(userId, fingerprint)
        await supabase
          .from('user_scans')
          .update({
            scan_count: currentCount + 1,
            last_scan_at: new Date().toISOString()
          })
          .eq('user_id', userId)
          .eq('scan_month', currentMonth)
      })
    }

    return true
  } catch (error) {
    console.error('[Increment Scan Error]:', error)
    return false
  }
}

/**
 * Middleware: Check user scan limit
 */
async function checkScanLimit(req, res, next) {
  try {
    const { userId, fingerprint } = req.body

    if (!userId) {
      return res.status(400).json({
        error: 'User identification required',
        message: 'Please enable cookies to use this service.'
      })
    }

    // Check if user is admin
    const isAdmin = await isAdminUser(userId)
    if (isAdmin) {
      console.log('[Scan Limit] Admin user - bypassing limit')
      req.isAdmin = true
      return next()
    }

    // Check scan count
    const scanCount = await getUserScanCount(userId, fingerprint)

    if (scanCount >= MAX_FREE_SCANS) {
      return res.status(429).json({
        error: 'Scan limit exceeded',
        message: `You've used all ${MAX_FREE_SCANS} free scans this month. Upgrade to Premium for unlimited scans.`,
        upgradeUrl: '/premium',
        scansUsed: scanCount,
        scansMax: MAX_FREE_SCANS
      })
    }

    // Store for later increment
    req.userTracking = { userId, fingerprint }
    next()
  } catch (error) {
    console.error('[Scan Limit Check Error]:', error)
    // Don't block on error - allow scan but log it
    next()
  }
}

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

    // Normalize fabric names (remove "Recycled" prefix from cached data)
    if (data.fabrics) {
      data.fabrics = data.fabrics.map(f => ({
        ...f,
        type: f.type.replace(/^Recycled\s+/i, '')
      }))
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

  // Detect if URL needs special JSON extraction (Alo Yoga, Lululemon, Gymshark)
  const useJsonExtraction = url.includes('aloyoga.com') || url.includes('lululemon.com') || url.includes('gymshark.com')
  const needsStealth = useJsonExtraction || url.includes('patagonia.com') || url.includes('abercrombie.com')

  try {
    // For Alo Yoga, Lululemon, and Gymshark, use JSON extraction instead of markdown
    if (useJsonExtraction) {
      const brand = url.includes('aloyoga.com') ? 'Alo Yoga' : url.includes('gymshark.com') ? 'Gymshark' : 'Lululemon'
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

// Extract fabric composition using Claude API (with optional streaming)
async function extractFabricComposition(scrapedContent, streamCallback = null) {
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
9. Extract performance keywords from product title/description (Tech, Performance, Moisture Wicking, Quick Dry, UPF, Dry Fit, Cooling, Athletic, etc.)

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
  "features": ["moisture-wicking", "4-way stretch"],
  "keywords": ["Performance", "Tech"]
}

The "keywords" field should contain searchable brand-agnostic terms from the product name/description (Tech, Performance, Sport, Athletic, Dry Fit, etc.) - NOT fabric features.

Product page content:
${scrapedContent}

Return ONLY the JSON object, no other text.`

  try {
    // Use streaming if callback provided
    if (streamCallback) {
      console.log('[Claude] Using streaming API')
      let fullText = ''

      const stream = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        stream: true,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const chunk = event.delta.text
          fullText += chunk

          // Send chunk to frontend via SSE
          streamCallback({
            type: 'chunk',
            data: chunk,
            accumulated: fullText
          })
        }
      }

      // Strip code fences and parse
      let responseText = fullText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const fabricData = JSON.parse(responseText)

      // Normalize fabric names (remove "Recycled" prefix)
      if (fabricData.fabrics) {
        fabricData.fabrics = fabricData.fabrics.map(f => ({
          ...f,
          type: f.type.replace(/^Recycled\s+/i, '')
        }))
      }

      // Send completion signal
      streamCallback({
        type: 'complete',
        data: fabricData
      })

      return fabricData
    } else {
      // Non-streaming fallback
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
      responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
      const fabricData = JSON.parse(responseText)

      // Normalize fabric names (remove "Recycled" prefix)
      if (fabricData.fabrics) {
        fabricData.fabrics = fabricData.fabrics.map(f => ({
          ...f,
          type: f.type.replace(/^Recycled\s+/i, '')
        }))
      }

      return fabricData
    }
  } catch (error) {
    console.error('[Claude API Error]:', error)
    throw new Error('Failed to extract fabric composition')
  }
}

// API Routes
// Apply security middleware: cost limit → burst limit → hourly limit → scan limit → URL validation
app.post('/api/analyze', checkCostLimit, burstLimiter, hourlyLimiter, checkScanLimit, validateUrl, async (req, res) => {
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

    // Step 1: Check cache first (HYBRID SYSTEM)
    const cachedData = await checkCache(url, refresh === true)

    if (cachedData) {
      console.log('[Cache] Returning cached result ⚡')

      // Generate alternatives even for cached results
      const alternatives = await searchProductAlternatives(
        {
          fabrics: cachedData.fabrics,
          quality_tier: cachedData.quality_tier,
          features: cachedData.features,
          product_type: cachedData.product_type,
          gender: cachedData.gender,
          keywords: cachedData.keywords
        },
        cachedData.brand,
        cachedData.product_type || 'athletic wear'
      )

      // Increment scan count for cached hits too (fire and forget)
      if (req.userTracking && !req.isAdmin) {
        incrementUserScanCount(req.userTracking.userId, req.userTracking.fingerprint)
          .catch(err => console.error('[Scan Count Increment Error]:', err))
      }

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

    // Step 2: Scrape with Firecrawl
    console.log('[Scraping] Fresh scrape from source')
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
        error: sanitizeError('Failed to scrape product page')
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

      // Normalize fabric names (remove "Recycled" prefix)
      if (fabricData.fabrics) {
        fabricData.fabrics = fabricData.fabrics.map(f => ({
          ...f,
          type: f.type.replace(/^Recycled\s+/i, '')
        }))
      }
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

    // Step 4: Save to cache for future lookups
    await saveToCache(url, fabricData)

    // Step 5: Search for real product alternatives
    const brand = extractBrand(url)
    const searchStart = Date.now()
    const alternatives = await searchProductAlternatives(
      fabricData,
      brand,
      fabricData.product_type || 'athletic wear'
    )
    const searchTime = Date.now() - searchStart

    // Track SerpAPI calls (4 total: 2 Amazon + 2 Google Shopping, reduced from 5)
    await trackApiCall('serpapi', {
      scanUrl: url,
      callCount: 4,
      responseTime: searchTime,
      status: 'success'
    })
    apiCallTracker.serpapi = 4

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

    // Increment scan count after successful scan (don't await - fire and forget)
    if (req.userTracking && !req.isAdmin) {
      incrementUserScanCount(req.userTracking.userId, req.userTracking.fingerprint)
        .catch(err => console.error('[Scan Count Increment Error]:', err))
    }

  } catch (error) {
    console.error('[API Error]:', error) // Full error logged server-side
    res.status(500).json({ error: sanitizeError(error) }) // Generic error sent to client
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
        num: 10, // Get top 10 results per query
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

    // Transform SerpAPI results into our format (get top 10 after filtering)
    return filteredResults.slice(0, 10).map(product => {
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

    // Transform Amazon results
    return results.organic_results.slice(0, 10).map(product => {
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

    // Return just the normalized fabric name (no synonyms in search query)
    return normalized
  }

  // Normalize fabric names (remove "Recycled" prefix)
  const normalizeFabricName = (fabricType) => {
    return fabricType.replace(/^Recycled\s+/i, '')
  }

  // Build fabric string with percentages and alternate names
  // e.g., "96% Polyester 4% Elastane"
  const fabricString = fabricData.fabrics
    .map(f => `${f.percentage}% ${getFabricWithAlternates(normalizeFabricName(f.type))}`)
    .join(' ')

  // Build keyword string from extracted keywords, excluding brand name
  const keywords = (fabricData.keywords || [])
    .filter(keyword => {
      const keywordLower = keyword.toLowerCase()

      // Exclude brand name from keywords (case-insensitive)
      if (brand && keywordLower.includes(brand.toLowerCase())) {
        return false
      }
      // Exclude if brand is contained in keyword (e.g., "Vuori" in "VuoriTech")
      if (brand && brand.toLowerCase().includes(keywordLower)) {
        return false
      }
      // Exclude "recycled" keywords (e.g., "Recycled Polyester")
      if (keywordLower.includes('recycled')) {
        return false
      }
      return true
    })
    .slice(0, 2)

  const keywordString = keywords.join(' ')

  // Build 2 optimized search queries (reduced from 3 to save API costs)
  const queries = []

  // Query 1: Fabric-based exact match
  queries.push({
    name: 'fabric-exact',
    query: gender && type
      ? `${gender} ${type} ${fabricString}`
      : `${type} ${fabricString}`
  })

  // Query 2: Keyword-based OR budget search (pick best one)
  if (keywordString) {
    // If we have keywords, use keyword search (better quality)
    queries.push({
      name: 'keyword',
      query: gender && type
        ? `${gender} ${type} ${keywordString}`
        : `${type} ${keywordString}`
    })
  } else {
    // No keywords? Fall back to budget search
    queries.push({
      name: 'budget',
      query: gender && type
        ? `budget ${gender} ${type} athletic`
        : `budget ${type} athletic`
    })
  }

  console.log(`[Search] Running searches: Amazon PAAPI + Amazon SerpAPI (2 queries) + Google Shopping (2 queries) - OPTIMIZED`)

  // Run queries in parallel: Amazon PAAPI + Amazon SerpAPI (2 queries) + Google Shopping SerpAPI (2 queries)
  // REDUCED: Google Shopping from 3 to 2 queries (saves $0.0036/scan)
  const fabricExactQuery = queries.find(q => q.name === 'fabric-exact')
  const secondQuery = queries.find(q => q.name === 'keyword') || queries.find(q => q.name === 'budget')

  const [amazonPaapiResults, amazonSerpExact, amazonSerpSecond, ...googleShoppingResults] = await Promise.all([
    searchAmazonProducts(fabricData, brand, productType),
    searchAmazonViaSerpApi(fabricData, brand, productType, fabricExactQuery?.query || `${gender} ${type} athletic`),
    searchAmazonViaSerpApi(fabricData, brand, productType, secondQuery?.query || `budget ${type} athletic`),
    ...queries.map(q => searchSerpApiProducts(fabricData, brand, productType, q.query))
  ])

  // Combine all Amazon results (PAAPI + SerpAPI)
  const allAmazonResults = [...amazonPaapiResults, ...amazonSerpExact, ...amazonSerpSecond]

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

  // Filter out the original brand and brand-specific keywords
  if (brand) {
    const originalCount = rankedProducts.length
    const brandKeywords = fabricData.keywords || []

    rankedProducts = rankedProducts.filter(product => {
      const title = product.title.toLowerCase()
      const brandName = brand.toLowerCase()

      // Exclude if contains brand name
      if (title.includes(brandName)) {
        return false
      }

      // Exclude if contains brand-specific keywords (like "DreamKnit" for Vuori)
      // Only exclude if keyword is capitalized/unique (likely brand-specific)
      for (const keyword of brandKeywords) {
        if (keyword.length > 5 && keyword[0] === keyword[0].toUpperCase()) {
          if (title.includes(keyword.toLowerCase())) {
            return false
          }
        }
      }

      return true
    })

    console.log(`[Filter] Removed ${originalCount - rankedProducts.length} products containing "${brand}" or brand keywords`)
  }

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

// Streaming version of /api/analyze using Server-Sent Events (SSE)
// Apply security middleware: cost limit → burst limit → hourly limit → URL validation
app.post('/api/analyze-stream', checkCostLimit, burstLimiter, hourlyLimiter, checkScanLimit, validateUrl, async (req, res) => {
  try {
    const { url, refresh } = req.body

    if (!url) {
      return res.status(400).json({ error: 'URL is required' })
    }

    // Validate Lululemon URLs
    if (url.includes('www.lululemon.com/products/')) {
      return res.status(400).json({
        error: 'Invalid Lululemon URL format',
        message: 'Please use shop.lululemon.com URLs instead of www.lululemon.com/products/.'
      })
    }

    // Set up Server-Sent Events
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Check if user is admin
    const isAdmin = req.cookies.admin_session === 'true'

    const sendEvent = (event, data) => {
      // Enrich all events with admin status
      const enrichedData = { ...data, isAdmin }
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(enrichedData)}\n\n`)
    }

    console.log(`\n[Streaming Analysis] URL: ${url}${refresh ? ' (FORCE REFRESH)' : ''}`)

    const scanStartTime = Date.now()

    // Step 1: Check cache
    sendEvent('status', { step: 'cache', message: 'Checking cache...' })
    const cachedData = await checkCache(url, refresh === true)

    if (cachedData) {
      console.log('[Cache] Returning cached result ⚡')
      sendEvent('status', { step: 'cache_hit', message: 'Found in cache!' })

      // Send fabric data immediately
      sendEvent('fabric', {
        product_name: cachedData.product_name,
        product_type: cachedData.product_type,
        gender: cachedData.gender,
        product_image: cachedData.product_image,
        fabrics: cachedData.fabrics,
        quality_tier: cachedData.quality_tier,
        features: cachedData.features,
        brand: cachedData.brand
      })

      // Search for alternatives
      sendEvent('status', { step: 'search', message: 'Finding cheaper alternatives...' })
      const alternatives = await searchProductAlternatives(
        {
          fabrics: cachedData.fabrics,
          quality_tier: cachedData.quality_tier,
          features: cachedData.features,
          product_type: cachedData.product_type,
          gender: cachedData.gender,
          keywords: cachedData.keywords
        },
        cachedData.brand,
        cachedData.product_type || 'athletic wear'
      )

      sendEvent('alternatives', { alternatives })
      sendEvent('complete', { cached: true, cached_at: cachedData.scraped_at })
      res.end()
      return
    }

    // Step 2: Scrape with Firecrawl
    sendEvent('status', { step: 'scrape', message: 'Scraping product page...' })
    const firecrawlStart = Date.now()
    const scrapedData = await scrapeWithFirecrawl(url)
    const firecrawlTime = Date.now() - firecrawlStart

    if (!scrapedData.success) {
      sendEvent('error', { message: sanitizeError('Failed to scrape product page') })
      res.end()
      return
    }

    await trackApiCall('firecrawl', {
      scanUrl: url,
      responseTime: firecrawlTime,
      status: 'success'
    })

    // Step 3: Extract fabric composition (with streaming!)
    let fabricData

    if (scrapedData.fabricData) {
      // JSON extraction already provided the data
      console.log('[Analysis] Using JSON-extracted data')
      fabricData = scrapedData.fabricData

      // Normalize fabric names (remove "Recycled" prefix)
      if (fabricData.fabrics) {
        fabricData.fabrics = fabricData.fabrics.map(f => ({
          ...f,
          type: f.type.replace(/^Recycled\s+/i, '')
        }))
      }

      sendEvent('fabric', {
        ...fabricData,
        brand: extractBrand(url)
      })
    } else {
      // Stream Claude extraction to frontend
      sendEvent('status', { step: 'extract', message: 'Analyzing fabric composition...' })

      const claudeStart = Date.now()
      fabricData = await extractFabricComposition(scrapedData.content, (streamData) => {
        // Stream chunks to frontend in real-time
        if (streamData.type === 'chunk') {
          sendEvent('claude_chunk', { text: streamData.data })
        } else if (streamData.type === 'complete') {
          sendEvent('fabric', {
            ...streamData.data,
            brand: extractBrand(url)
          })
        }
      })
      const claudeTime = Date.now() - claudeStart

      await trackApiCall('claude', {
        scanUrl: url,
        responseTime: claudeTime,
        status: 'success'
      })
    }

    // Step 4: Save to cache
    await saveToCache(url, fabricData)

    // Step 5: Search for alternatives
    sendEvent('status', { step: 'search', message: 'Finding cheaper alternatives...' })
    const brand = extractBrand(url)
    const searchStart = Date.now()
    const alternatives = await searchProductAlternatives(
      fabricData,
      brand,
      fabricData.product_type || 'athletic wear'
    )
    const searchTime = Date.now() - searchStart

    await trackApiCall('serpapi', {
      scanUrl: url,
      callCount: 4,
      responseTime: searchTime,
      status: 'success'
    })

    await trackApiCall('claude', {
      scanUrl: url,
      callCount: 1,
      responseTime: searchTime,
      status: 'success',
      metadata: { purpose: 'product_scoring' }
    })

    const totalTime = Date.now() - scanStartTime

    printApiSummary({
      claudeCalls: 2,
      serpapiCalls: 4,
      firecrawlCalls: 1,
      totalCost: (1 * 0.015) + (2 * 0.0075) + (4 * 0.0036),
      scanTime: totalTime
    })

    // Send alternatives and complete
    sendEvent('alternatives', { alternatives })
    sendEvent('complete', { cached: false, scanTime: totalTime })
    res.end()

    // Increment scan count after successful scan (don't await - fire and forget)
    if (req.userTracking && !req.isAdmin) {
      incrementUserScanCount(req.userTracking.userId, req.userTracking.fingerprint)
        .catch(err => console.error('[Scan Count Increment Error]:', err))
    }

  } catch (error) {
    console.error('[Streaming API Error]:', error) // Full error logged server-side
    res.write(`event: error\n`)
    res.write(`data: ${JSON.stringify({ message: sanitizeError(error) })}\n\n`) // Generic error sent to client
    res.end()
  }
})

// API route to get product alternatives
// Apply rate limiting (no URL validation needed - this endpoint receives fabric data, not URLs)
app.post('/api/alternatives', burstLimiter, hourlyLimiter, async (req, res) => {
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
    console.error('[Alternatives API Error]:', error) // Full error logged server-side
    res.status(500).json({ error: sanitizeError(error) }) // Generic error sent to client
  }
})

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ============================================================================
// ADMIN ACCESS ROUTES
// ============================================================================

/**
 * Admin verification endpoint
 * Usage: fabricfinder.fit/admin?key=YOUR_SECRET_KEY
 * Sets httpOnly cookie that persists for 90 days
 */
app.get('/api/admin/verify', (req, res) => {
  const { key } = req.query

  if (!key || !isValidAdminKey(key)) {
    return res.status(401).json({
      isAdmin: false,
      error: 'Invalid admin key'
    })
  }

  // Set secure httpOnly cookie (secure in production)
  res.cookie('admin_session', 'true', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 90 * 24 * 60 * 60 * 1000, // 90 days
    sameSite: 'strict'
  })

  console.log('[ADMIN] Admin access granted')

  res.json({
    isAdmin: true,
    message: 'Admin access granted. You now have unlimited scans and no ads.'
  })
})

/**
 * Check admin status endpoint
 * Returns whether the current user is an admin
 */
app.get('/api/admin/status', (req, res) => {
  const isAdmin = req.cookies.admin_session === 'true'
  res.json({ isAdmin })
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

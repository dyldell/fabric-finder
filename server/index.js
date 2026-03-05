import dotenv from 'dotenv'
// Load .env FIRST before any other imports that use env vars
dotenv.config()

import express from 'express'
import cors from 'cors'
import compression from 'compression'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import cookieParser from 'cookie-parser'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
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

// ES module __dirname equivalent
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3000

// Trust proxy (required for Render, Heroku, etc. to get real client IPs)
app.set('trust proxy', true)

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

// Admin authentication rate limiter: 5 attempts per 15 minutes (brute force protection)
const adminAuthLimiter = rateLimit({
  windowMs: RATE_LIMITS.adminAuth.windowMs,
  max: RATE_LIMITS.adminAuth.max,
  message: RATE_LIMITS.adminAuth.message,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true  // Only count failed attempts
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
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY,
  {
    db: {
      pooler: {
        min: 2,                      // Minimum connections in pool
        max: 10,                     // Maximum connections (fits Supabase free tier 20 connection limit)
        idleTimeoutMillis: 30000     // Close idle connections after 30 seconds
      }
    },
    global: {
      headers: {
        'x-application-name': 'fabricfinder'  // Identify connections in Supabase dashboard
      }
    }
  }
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
    'shopcsb.com': 'CSB',
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

// Try simple HTTP fetch first (cheap, fast)
async function scrapeWithSimpleFetch(url) {
  console.log(`[Simple Fetch] Attempting basic scrape: ${url}`)

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000
    })

    // Check for bot protection or errors
    if (!response.ok) {
      console.log(`[Simple Fetch] Failed: ${response.status} ${response.statusText}`)
      return { success: false, needsFirecrawl: true }
    }

    const html = await response.text()

    // Check for common bot protection signatures
    const botProtectionSignatures = [
      'cloudflare',
      'please enable javascript',
      'checking your browser',
      'access denied',
      'captcha',
      'are you a robot'
    ]

    const htmlLower = html.toLowerCase()
    const hasBotProtection = botProtectionSignatures.some(sig => htmlLower.includes(sig))

    if (hasBotProtection || html.length < 500) {
      console.log(`[Simple Fetch] Bot protection detected or page too small`)
      return { success: false, needsFirecrawl: true }
    }

    console.log(`[Simple Fetch] Success - ${html.length} chars`)
    return {
      success: true,
      content: html,
      url
    }
  } catch (error) {
    console.log(`[Simple Fetch] Error: ${error.message}`)
    return { success: false, needsFirecrawl: true }
  }
}

// Improved Firecrawl scraping with better error handling
async function scrapeWithFirecrawl(url) {
  console.log(`[Firecrawl] Scraping URL: ${url}`)

  // Detect if URL needs special JSON extraction (Alo Yoga, Lululemon, Gymshark)
  const useJsonExtraction = url.includes('aloyoga.com') || url.includes('lululemon.com') || url.includes('gymshark.com')

  // Known easy brands that don't need stealth
  const easyBrands = ['vuoriclothing.com', 'shopcsb.com']
  const isEasyBrand = easyBrands.some(brand => url.includes(brand))

  // Use stealth mode by default for all brands EXCEPT known easy ones
  // This allows any brand to work, even unknown ones
  const needsStealth = !isEasyBrand

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
10. For men's shorts ONLY: Extract the inseam length if specified (e.g., "5\"", "7\"", "9\"") - return as string with quotes (e.g., "5\"")

Example:
If you see "Pocket Lining: 90% Polyester, 10% Lycra | Body: 71% Nylon, 29% Lycra Elastane"
Extract ONLY: [{"type": "Nylon", "percentage": 71}, {"type": "Lycra Elastane", "percentage": 29}]

Return ONLY a valid JSON object with this exact structure:
{
  "product_name": "Pace Breaker Short 7\"",
  "product_type": "shorts",
  "gender": "mens",
  "inseam": "7\"",
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
The "inseam" field should ONLY be included for men's shorts when an inseam length is found (5", 7", 9", etc.)

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
  // Set request timeout (60 seconds) to prevent hung requests
  const requestTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error('[Timeout] Request exceeded 60 second limit')
      res.status(504).json({
        error: 'Request timeout',
        message: 'Analysis took too long. This could happen if the product page is very complex. Please try again or try a different URL.'
      })
    }
  }, 60000) // 60 second timeout

  try {
    const { url, refresh } = req.body

    if (!url) {
      clearTimeout(requestTimeout)
      return res.status(400).json({ error: 'URL is required' })
    }

    // Validate Lululemon URLs - www.lululemon.com/products/ URLs often redirect incorrectly
    if (url.includes('www.lululemon.com/products/')) {
      clearTimeout(requestTimeout)
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

      clearTimeout(requestTimeout)
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

    // Step 2: Two-tier scraping - try simple fetch first, fallback to Firecrawl
    console.log('[Scraping] Fresh scrape from source')
    let scrapedData
    let usedFirecrawl = false

    // Tier 1: Try simple HTTP fetch (cheap)
    const simpleFetchStart = Date.now()
    const simpleFetchResult = await scrapeWithSimpleFetch(url)
    const simpleFetchTime = Date.now() - simpleFetchStart

    if (simpleFetchResult.success) {
      console.log('[Scraping] Simple fetch succeeded - no Firecrawl needed!')
      scrapedData = simpleFetchResult
    } else {
      // Tier 2: Fallback to Firecrawl stealth (expensive)
      console.log('[Scraping] Simple fetch failed - using Firecrawl stealth')
      const firecrawlStart = Date.now()
      scrapedData = await scrapeWithFirecrawl(url)
      const firecrawlTime = Date.now() - firecrawlStart
      usedFirecrawl = true

      if (!scrapedData.success) {
        // Track failed Firecrawl call
        await trackApiCall('firecrawl', {
          scanUrl: url,
          responseTime: firecrawlTime,
          status: 'error'
        })
        clearTimeout(requestTimeout)
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
    }

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

    // Clear timeout before sending response
    clearTimeout(requestTimeout)

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
    clearTimeout(requestTimeout)
    console.error('[API Error]:', error) // Full error logged server-side
    if (!res.headersSent) {
      res.status(500).json({ error: sanitizeError(error) }) // Generic error sent to client
    }
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
  const inseam = fabricData.inseam || '' // Extract inseam for men's shorts
  const productName = (fabricData.product_name || '').toLowerCase()

  // Women's "pants" in athletic context = leggings (EXCEPT wideleg/straight leg pants)
  if (gender === 'womens' && (type === 'pants' || type === 'pant')) {
    // Keep as "pant" if it's wideleg, straight leg, or jogger
    if (!productName.includes('wideleg') && !productName.includes('straight') && !productName.includes('jogger')) {
      type = 'leggings'
    }
  }

  // CRITICAL: Preserve important product descriptors (puffer, insulated, down, etc.)
  // These are essential for accurate search results
  // Order matters - more specific descriptors first to avoid generic matches
  const importantDescriptors = [
    'puffer', 'puff',  // Puffer jackets (very specific)
    'down',            // Down jackets/vests (specific)
    'fleece',          // Fleece (specific material)
    'quilted',         // Quilted jackets (specific style)
    'windbreaker', 'rain', 'waterproof',  // Weather-specific
    'softshell', 'hardshell',  // Technical jackets
    'thermal',         // Thermal layers
    'insulated',       // Generic insulation (catch-all)
    'packable', 'vest', 'hooded', 'zip'
  ]

  let productDescriptor = ''
  for (const descriptor of importantDescriptors) {
    if (productName.includes(descriptor)) {
      productDescriptor = descriptor
      console.log(`[Search] Important descriptor detected: "${descriptor}"`)
      break // Use first match
    }
  }

  // Add descriptor to type if found (e.g., "jacket" → "puffer jacket")
  if (productDescriptor) {
    type = `${productDescriptor} ${type}`
  }

  // For men's shorts, add inseam to type if available
  let typeWithInseam = type
  if (gender === 'mens' && (type === 'shorts' || type === 'short') && inseam) {
    typeWithInseam = `${inseam} ${type}`
    console.log(`[Search] Men's shorts detected - using inseam: ${inseam}`)
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

  // Query 1: Fabric-based exact match (with inseam for men's shorts)
  queries.push({
    name: 'fabric-exact',
    query: gender && typeWithInseam
      ? `${gender} ${typeWithInseam} ${fabricString}`
      : `${typeWithInseam} ${fabricString}`
  })

  // Query 2: Keyword-based OR budget search (pick best one)
  if (keywordString) {
    // If we have keywords, use keyword search (better quality)
    queries.push({
      name: 'keyword',
      query: gender && typeWithInseam
        ? `${gender} ${typeWithInseam} ${keywordString}`
        : `${typeWithInseam} ${keywordString}`
    })
  } else {
    // No keywords? Fall back to budget search
    queries.push({
      name: 'budget',
      query: gender && typeWithInseam
        ? `budget ${gender} ${typeWithInseam} athletic`
        : `budget ${typeWithInseam} athletic`
    })
  }

  // EXCLUSION KEYWORDS: Block dress/formal wear (athletic wear only)
  const exclusions = '-dress -button -oxford -formal -casual -flannel'

  // NEW Query 3: Amazon-specific fabric percentage search (prioritize exact matches)
  const amazonFabricQuery = gender && typeWithInseam
    ? `${fabricString} ${gender} ${typeWithInseam} performance ${exclusions}`
    : `${fabricString} ${typeWithInseam} performance ${exclusions}`

  console.log(`[Search] Running searches: Amazon PAAPI + Amazon SerpAPI (3 queries) + Google Shopping (2 queries) - FABRIC OPTIMIZED`)

  // Run queries in parallel: Amazon PAAPI + Amazon SerpAPI (3 queries) + Google Shopping SerpAPI (2 queries)
  // NEW: Added third Amazon query specifically for fabric percentages
  const fabricExactQuery = queries.find(q => q.name === 'fabric-exact')
  const secondQuery = queries.find(q => q.name === 'keyword') || queries.find(q => q.name === 'budget')

  const [amazonPaapiResults, amazonSerpFabric, amazonSerpExact, amazonSerpSecond, ...googleShoppingResults] = await Promise.all([
    searchAmazonProducts(fabricData, brand, productType),
    searchAmazonViaSerpApi(fabricData, brand, productType, amazonFabricQuery),
    searchAmazonViaSerpApi(fabricData, brand, productType, `${fabricExactQuery?.query || `${gender} ${typeWithInseam} athletic`} ${exclusions}`),
    searchAmazonViaSerpApi(fabricData, brand, productType, `${secondQuery?.query || `budget ${typeWithInseam} athletic`} ${exclusions}`),
    ...queries.map(q => searchSerpApiProducts(fabricData, brand, productType, `${q.query} ${exclusions}`))
  ])

  // Combine all Amazon results (PAAPI + SerpAPI x3)
  const allAmazonResults = [...amazonPaapiResults, ...amazonSerpFabric, ...amazonSerpExact, ...amazonSerpSecond]

  // Flatten Google Shopping results
  const allGoogleShoppingResults = googleShoppingResults.flat()

  // Combine everything
  let allResults = [...allAmazonResults, ...allGoogleShoppingResults]

  // HARDCODED ODODOS DUPES: 15 Vuori products mapped to exact ODODOS alternatives
  // These are guaranteed 100% or 99% matches that always show first
  if (brand?.toLowerCase() === 'vuori') {
    const productName = (fabricData.product_name || '').toLowerCase()
    const productTypeLower = type?.toLowerCase() || ''
    const genderLower = (fabricData.gender || '').toLowerCase()

    let ododos = null

    // DETECT PRODUCT TYPE AND INJECT CORRESPONDING ODODOS PRODUCT
    // Men's 100% Exact Matches (Strato line - exact fabric)
    if (genderLower.includes('men') && !genderLower.includes('women')) {
      if (productName.includes('strato') && productName.includes('long') && (productTypeLower.includes('tee') || productName.includes('tee'))) {
        // Long Sleeve Strato Tech Tee
        ododos = {
          title: "ODODOS Men's Long Sleeve Performance T-Shirt - odSTRATUM Tech Tee",
          price: "$23.98",
          image: "https://m.media-amazon.com/images/I/71yP3tP3jsL._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0F484X2ZV",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('hoodie')) {
        // Strato Tech Hoodie
        ododos = {
          title: "ODODOS Men's Long Sleeve Hoodie - odSTRATUM Tech Performance Pullover",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71HCAJBlFlL._AC_SY606_.jpg",
          url: "https://www.amazon.com/dp/B0FQJDRP6T",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('long') && productName.includes('polo')) {
        // Long Sleeve Strato Tech Polo
        ododos = {
          title: "ODODOS Men's Performance Long Sleeve Polo - odSTRATUM Tech Golf T-Shirts",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/81wVahwe-5L._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0FRFMZ11Z",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('polo')) {
        // Short Sleeve Strato Tech Polo
        ododos = {
          title: "ODODOS Men's Performance Polo - odSTRATUM Tech Short Sleeve Golf T-Shirts",
          price: "$25.18",
          image: "https://m.media-amazon.com/images/I/71rEELBs7NL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F487PZQV",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('muscle')) {
        // Strato Muscle Tee
        ododos = {
          title: "ODODOS Men's Performance Tank Top - Ultra Soft odSTRATUM Tech Sleeveless Shirts",
          price: "$17.98",
          image: "https://m.media-amazon.com/images/I/71Uq5jl4p1L._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FK4RRR2J",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('tank')) {
        // Strato Tech Tank
        ododos = {
          title: "ODODOS Men's Performance Tank - odSTRATUM Tech Muscle Tee",
          price: "$16.98",
          image: "https://m.media-amazon.com/images/I/71GDCyT8GNL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F385K44S",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && (productTypeLower.includes('tee') || productName.includes('tee'))) {
        // Short Sleeve Strato Tech Tee (default)
        ododos = {
          title: "ODODOS Men's Performance T-Shirt - odSTRATUM Tech Tee",
          price: "$16.99",
          image: "https://m.media-amazon.com/images/I/71yP3tP3jsL._AC_SY500_.jpg",
          url: "https://www.amazon.com/ODODOS-Mens-Performance-T-Shirt-odSTRATUM/dp/B0FLQ22KQ9",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('coronado') && productName.includes('zip')) {
        // Coronado Full Zip Hoodie - 99%
        ododos = {
          title: "ODODOS Men's Full-Zip Hoodie - odSTRATUM Tech Ultra Soft Outfit",
          price: "$35.98",
          image: "https://m.media-amazon.com/images/I/71Rr8GHbRdL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FWCDG4MB",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('ponto') && productName.includes('jogger')) {
        // Ponto Performance Jogger - 99%
        ododos = {
          title: "ODODOS Men's Performance Joggers - Ultra Soft odSTRATUM Tech Sweatpants",
          price: "$39.98",
          image: "https://m.media-amazon.com/images/I/71OYCGNW3BL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0G24BX6MZ",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('ponto') && productName.includes('short')) {
        // Ponto Short - 99%
        ododos = {
          title: "ODODOS Men's Performance Shorts 7\" – Ultra Soft odSTRATUM Tech Everyday Shorts",
          price: "$32.00",
          image: "https://m.media-amazon.com/images/I/81GLbeq0NrL._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0G24QCWR1",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      }
    }
    // Women's Products
    else if (genderLower.includes('women')) {
      if (productName.includes('daydream') && productName.includes('crew')) {
        // Women's Daydream Crew - 100%
        ododos = {
          title: "ODODOS Women's Long Sleeve Crewneck Tee - Ultra-Soft odSTRATUM Tech",
          price: "$23.98",
          image: "https://m.media-amazon.com/images/I/717qloPuYHL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0GHNQSZBX",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('performance') && productName.includes('jogger')) {
        // Women's Performance Jogger - 99%
        ododos = {
          title: "ODODOS Women's Performance Joggers - Ultra Soft odSTRATUM Tech Sweatpants",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71j56NzOcGL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0G24CRQYQ",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && (productName.includes('wideleg') || productName.includes('pant') || productName.includes('legging'))) {
        // Women's Halo Essential Wideleg Pant/Legging - 99% (check BEFORE shorts - "pant-short/long" refers to inseam)
        ododos = {
          title: "ODODOS Women's Straight Leg Pants Ultra Soft odSTRATUM Tech",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71JUsR1qXWL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FV8CDTQC",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && productName.includes('short') && !productName.includes('pant') && !productName.includes('legging')) {
        // Women's Halo Performance Short - 99% (only if NOT "pant-short" or "legging-short")
        ododos = {
          title: "ODODOS Women's Performance Shorts Ultra Soft odSTRATUM Tech Mid Rise",
          price: "$24.28",
          image: "https://m.media-amazon.com/images/I/711fHs8WyEL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F6TVXP88",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && productName.includes('hoodie')) {
        // Women's Halo Performance Hoodie - 99%
        ododos = {
          title: "ODODOS Women's Full-Zip Hoodie - odSTRATUM Tech Ultra Soft Outfit",
          price: "$39.98",
          image: "https://m.media-amazon.com/images/I/81gKjysfHzL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FNMM4ZZM",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      }
    }

    // Inject if matched
    if (ododos) {
      const fullProduct = {
        ...ododos,
        originalPrice: null,
        source: "Amazon",
        rating: "4.5",
        reviews: "10,000+",
        delivery: null,
        _hardcoded: true
      }
      allResults.unshift(fullProduct)
      console.log(`[HARDCODED] Injected ODODOS ${ododos.matchPercentage}% match: ${ododos.title.substring(0, 50)}`)
    }
  }

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

  // Sort by SOURCE first (Amazon prioritized), then by match percentage
  rankedProducts.sort((a, b) => {
    // Amazon always comes first
    const aIsAmazon = a.source === 'Amazon' ? 1 : 0
    const bIsAmazon = b.source === 'Amazon' ? 1 : 0

    if (aIsAmazon !== bIsAmazon) {
      return bIsAmazon - aIsAmazon // Amazon first
    }

    // Within same source, sort by match percentage
    return b.matchPercentage - a.matchPercentage
  })

  console.log(`[Search] Sorted by source (Amazon first), then fabric match %`)

  // Filter out dress/formal wear (buttons, oxford, formal shirts)
  const dressShirtKeywords = ['dress shirt', 'button-up', 'button-down', 'oxford', 'formal shirt', 'flannel']
  const beforeFilter = rankedProducts.length
  rankedProducts = rankedProducts.filter(product => {
    const titleLower = (product.title || '').toLowerCase()
    return !dressShirtKeywords.some(keyword => titleLower.includes(keyword))
  })
  if (beforeFilter > rankedProducts.length) {
    console.log(`[Filter] Removed ${beforeFilter - rankedProducts.length} dress/formal shirts`)
  }

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

      // Exclude ONLY truly brand-specific keywords (like "DreamKnit" for Vuori)
      // Do NOT filter generic product terms like "Strato", "Tech", "Performance"
      const genericTerms = ['strato', 'tech', 'performance', 'moisture', 'wicking', 'athletic', 'dry', 'fit']

      for (const keyword of brandKeywords) {
        const keywordLower = keyword.toLowerCase()

        // Skip if it's a generic term (not brand-specific)
        if (genericTerms.some(term => keywordLower.includes(term))) {
          continue
        }

        // Only exclude unique brand-specific keywords (>5 chars, capitalized, not generic)
        if (keyword.length > 5 && keyword[0] === keyword[0].toUpperCase()) {
          if (title.includes(keywordLower)) {
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

// PROGRESSIVE VERSION: Send results in batches as they come in
async function searchProductAlternativesProgressive(fabricData, brand, productType = 'athletic wear', onProgress) {
  console.log('[Search Progressive] Starting batch search strategy')

  const gender = fabricData.gender || ''
  let type = fabricData.product_type || productType
  const productName = (fabricData.product_name || '').toLowerCase()

  if (gender === 'womens' && (type === 'pants' || type === 'pant')) {
    if (!productName.includes('wideleg') && !productName.includes('straight') && !productName.includes('jogger')) {
      type = 'leggings'
    }
  }

  // CRITICAL: Preserve important product descriptors (same as regular search)
  // Order matters - more specific descriptors first
  const importantDescriptors = [
    'puffer', 'puff',  // Puffer jackets (very specific)
    'down',            // Down jackets/vests (specific)
    'fleece',          // Fleece (specific material)
    'quilted',         // Quilted jackets (specific style)
    'windbreaker', 'rain', 'waterproof',  // Weather-specific
    'softshell', 'hardshell',  // Technical jackets
    'thermal',         // Thermal layers
    'insulated',       // Generic insulation (catch-all)
    'packable', 'vest', 'hooded', 'zip'
  ]

  let productDescriptor = ''
  for (const descriptor of importantDescriptors) {
    if (productName.includes(descriptor)) {
      productDescriptor = descriptor
      console.log(`[Progressive Search] Important descriptor detected: "${descriptor}"`)
      break
    }
  }

  if (productDescriptor) {
    type = `${productDescriptor} ${type}`
  }

  const fabricString = fabricData.fabrics
    .map(f => `${f.percentage}% ${f.type.replace(/^Recycled\s+/i, '')}`)
    .join(' ')

  const typeWithInseam = type

  // HARDCODED ODODOS DUPES: 15 Vuori products mapped to exact ODODOS alternatives
  // These are guaranteed 100% or 99% matches that always show first
  let ododos = null
  if (brand?.toLowerCase() === 'vuori') {
    const productTypeLower = type?.toLowerCase() || ''
    const genderLower = (fabricData.gender || '').toLowerCase()

    // DETECT PRODUCT TYPE AND INJECT CORRESPONDING ODODOS PRODUCT
    // Men's 100% Exact Matches (Strato line - exact fabric)
    if (genderLower.includes('men') && !genderLower.includes('women')) {
      if (productName.includes('strato') && productName.includes('long') && (productTypeLower.includes('tee') || productName.includes('tee'))) {
        // Long Sleeve Strato Tech Tee
        ododos = {
          title: "ODODOS Men's Long Sleeve Performance T-Shirt - odSTRATUM Tech Tee",
          price: "$23.98",
          image: "https://m.media-amazon.com/images/I/71yP3tP3jsL._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0F484X2ZV",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('hoodie')) {
        // Strato Tech Hoodie
        ododos = {
          title: "ODODOS Men's Long Sleeve Hoodie - odSTRATUM Tech Performance Pullover",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71HCAJBlFlL._AC_SY606_.jpg",
          url: "https://www.amazon.com/dp/B0FQJDRP6T",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('long') && productName.includes('polo')) {
        // Long Sleeve Strato Tech Polo
        ododos = {
          title: "ODODOS Men's Performance Long Sleeve Polo - odSTRATUM Tech Golf T-Shirts",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/81wVahwe-5L._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0FRFMZ11Z",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('polo')) {
        // Short Sleeve Strato Tech Polo
        ododos = {
          title: "ODODOS Men's Performance Polo - odSTRATUM Tech Short Sleeve Golf T-Shirts",
          price: "$25.18",
          image: "https://m.media-amazon.com/images/I/71rEELBs7NL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F487PZQV",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('muscle')) {
        // Strato Muscle Tee
        ododos = {
          title: "ODODOS Men's Performance Tank Top - Ultra Soft odSTRATUM Tech Sleeveless Shirts",
          price: "$17.98",
          image: "https://m.media-amazon.com/images/I/71Uq5jl4p1L._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FK4RRR2J",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && productName.includes('tank')) {
        // Strato Tech Tank
        ododos = {
          title: "ODODOS Men's Performance Tank - odSTRATUM Tech Muscle Tee",
          price: "$16.98",
          image: "https://m.media-amazon.com/images/I/71GDCyT8GNL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F385K44S",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('strato') && (productTypeLower.includes('tee') || productName.includes('tee'))) {
        // Short Sleeve Strato Tech Tee (default)
        ododos = {
          title: "ODODOS Men's Performance T-Shirt - odSTRATUM Tech Tee",
          price: "$16.99",
          image: "https://m.media-amazon.com/images/I/71yP3tP3jsL._AC_SY500_.jpg",
          url: "https://www.amazon.com/ODODOS-Mens-Performance-T-Shirt-odSTRATUM/dp/B0FLQ22KQ9",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('coronado') && productName.includes('zip')) {
        // Coronado Full Zip Hoodie - 99%
        ododos = {
          title: "ODODOS Men's Full-Zip Hoodie - odSTRATUM Tech Ultra Soft Outfit",
          price: "$35.98",
          image: "https://m.media-amazon.com/images/I/71Rr8GHbRdL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FWCDG4MB",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('ponto') && productName.includes('jogger')) {
        // Ponto Performance Jogger - 99%
        ododos = {
          title: "ODODOS Men's Performance Joggers - Ultra Soft odSTRATUM Tech Sweatpants",
          price: "$39.98",
          image: "https://m.media-amazon.com/images/I/71OYCGNW3BL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0G24BX6MZ",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('ponto') && productName.includes('short')) {
        // Ponto Short - 99%
        ododos = {
          title: "ODODOS Men's Performance Shorts 7\" – Ultra Soft odSTRATUM Tech Everyday Shorts",
          price: "$32.00",
          image: "https://m.media-amazon.com/images/I/81GLbeq0NrL._AC_SY500_.jpg",
          url: "https://www.amazon.com/dp/B0G24QCWR1",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      }
    }
    // Women's Products
    else if (genderLower.includes('women')) {
      if (productName.includes('daydream') && productName.includes('crew')) {
        // Women's Daydream Crew - 100%
        ododos = {
          title: "ODODOS Women's Long Sleeve Crewneck Tee - Ultra-Soft odSTRATUM Tech",
          price: "$23.98",
          image: "https://m.media-amazon.com/images/I/717qloPuYHL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0GHNQSZBX",
          features: ["96% Polyester, 4% Elastane"], matchPercentage: 100
        }
      } else if (productName.includes('performance') && productName.includes('jogger')) {
        // Women's Performance Jogger - 99%
        ododos = {
          title: "ODODOS Women's Performance Joggers - Ultra Soft odSTRATUM Tech Sweatpants",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71j56NzOcGL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0G24CRQYQ",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && (productName.includes('wideleg') || productName.includes('pant') || productName.includes('legging'))) {
        // Women's Halo Essential Wideleg Pant/Legging - 99% (check BEFORE shorts - "pant-short/long" refers to inseam)
        ododos = {
          title: "ODODOS Women's Straight Leg Pants Ultra Soft odSTRATUM Tech",
          price: "$26.98",
          image: "https://m.media-amazon.com/images/I/71JUsR1qXWL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FV8CDTQC",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && productName.includes('short') && !productName.includes('pant') && !productName.includes('legging')) {
        // Women's Halo Performance Short - 99% (only if NOT "pant-short" or "legging-short")
        ododos = {
          title: "ODODOS Women's Performance Shorts Ultra Soft odSTRATUM Tech Mid Rise",
          price: "$24.28",
          image: "https://m.media-amazon.com/images/I/711fHs8WyEL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0F6TVXP88",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      } else if (productName.includes('halo') && productName.includes('hoodie')) {
        // Women's Halo Performance Hoodie - 99%
        ododos = {
          title: "ODODOS Women's Full-Zip Hoodie - odSTRATUM Tech Ultra Soft Outfit",
          price: "$39.98",
          image: "https://m.media-amazon.com/images/I/81gKjysfHzL._AC_SY445_.jpg",
          url: "https://www.amazon.com/dp/B0FNMM4ZZM",
          features: ["Polyester/Elastane blend"], matchPercentage: 99
        }
      }
    }

    // Inject if matched
    if (ododos) {
      console.log(`[HARDCODED PROGRESSIVE] Injected ODODOS ${ododos.matchPercentage}% match: ${ododos.title.substring(0, 50)}`)
    }
  }

  const amazonFabricQuery = gender && typeWithInseam
    ? `${fabricString} ${gender} ${typeWithInseam}`
    : `${fabricString} ${typeWithInseam}`

  // BATCH 1: Amazon searches only (fast, ~8-10s)
  console.log('[Progressive] Starting Amazon batch...')
  const [amazonPaapiResults, amazonSerpFabric, amazonSerpExact, amazonSerpSecond] = await Promise.all([
    searchAmazonProducts(fabricData, brand, productType),
    searchAmazonViaSerpApi(fabricData, brand, productType, amazonFabricQuery),
    searchAmazonViaSerpApi(fabricData, brand, productType, `${gender} ${typeWithInseam} ${fabricString}`),
    searchAmazonViaSerpApi(fabricData, brand, productType, `${gender} ${typeWithInseam} athletic`)
  ])

  const allAmazonResults = [...amazonPaapiResults, ...amazonSerpFabric, ...amazonSerpExact, ...amazonSerpSecond]

  // Inject hardcoded product at the beginning
  if (ododos) {
    const fullProduct = {
      ...ododos,
      originalPrice: null,
      source: "Amazon",
      rating: "4.5",
      reviews: "10,000+",
      delivery: null,
      _hardcoded: true
    }
    allAmazonResults.unshift(fullProduct)
  }

  // Send Amazon results immediately (don't wait for Google Shopping)
  if (allAmazonResults.length > 0 && onProgress) {
    const amazonOnly = await scoreAndRankProducts(fabricData.fabrics, allAmazonResults, type)
    const topAmazon = amazonOnly.slice(0, 5) // Send top 5 Amazon results
    onProgress(topAmazon, 'amazon')
  }

  // BATCH 2: Google Shopping (slower, runs in parallel with user seeing Amazon results)
  console.log('[Progressive] Starting Google Shopping batch...')
  const googleShoppingResults = await Promise.all([
    searchSerpApiProducts(fabricData, brand, productType, `${gender} ${typeWithInseam} ${fabricString}`),
    searchSerpApiProducts(fabricData, brand, productType, `${gender} ${typeWithInseam} athletic`)
  ])

  const allGoogleShoppingResults = googleShoppingResults.flat()
  const allResults = [...allAmazonResults, ...allGoogleShoppingResults]

  // Deduplicate and rank final results (same as original function)
  const seenUrls = new Set()
  const seenTitles = new Map()
  const deduplicatedResults = allResults.filter(product => {
    if (seenUrls.has(product.url)) return false
    const titleKey = `${product.source}:${product.title?.substring(0, 30)}`
    if (seenTitles.has(titleKey)) return false
    seenUrls.add(product.url)
    seenTitles.set(titleKey, product)
    return true
  })

  let allProducts = deduplicatedResults

  if (allProducts.length === 0) {
    return generateFallbackAlternatives(fabricData, brand, productType)
  }

  let rankedProducts = await scoreAndRankProducts(fabricData.fabrics, allProducts, type)

  // Sort by SOURCE first (Amazon prioritized), then by match percentage
  rankedProducts.sort((a, b) => {
    // Amazon always comes first
    const aIsAmazon = a.source === 'Amazon' ? 1 : 0
    const bIsAmazon = b.source === 'Amazon' ? 1 : 0

    if (aIsAmazon !== bIsAmazon) {
      return bIsAmazon - aIsAmazon // Amazon first
    }

    // Within same source, sort by match percentage
    return b.matchPercentage - a.matchPercentage
  })

  // Filter brand
  if (brand) {
    const brandKeywords = fabricData.keywords || []
    rankedProducts = rankedProducts.filter(product => {
      const title = product.title.toLowerCase()
      if (title.includes(brand.toLowerCase())) return false
      const genericTerms = ['strato', 'tech', 'performance', 'moisture', 'wicking', 'athletic', 'dry', 'fit']
      for (const keyword of brandKeywords) {
        const keywordLower = keyword.toLowerCase()
        if (genericTerms.some(term => keywordLower.includes(term))) continue
        if (keyword.length > 5 && keyword[0] === keyword[0].toUpperCase()) {
          if (title.includes(keywordLower)) return false
        }
      }
      return true
    })
  }

  console.log(`[Progressive] Final ${rankedProducts.length} products`)
  if (onProgress) {
    onProgress(rankedProducts.slice(0, 10), 'final')
  }

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

CRITICAL FABRIC MATCHING RULES:
1. **Exact fabric percentages in title/features = 95-100% match** (e.g., "75% Polyamide 25% Elastane")
2. **Wrong base fabric = MAX 40% match** (e.g., "100% Polyester" when searching for Polyamide/Elastane blend)
3. **Nylon = Polyamide** (same fiber, different names)
4. **Elastane = Spandex = Lycra** (same fiber, different brands)

Fabric hierarchy (for ${originalFabricString}):
- BEST: Mentions exact percentages matching target (95-100%)
- GOOD: Mentions correct base fabrics without percentages (85-94%)
- OKAY: Performance keywords suggesting similar blend (75-84%)
- POOR: Wrong base fabric or 100% single material when blend expected (20-40%)

Scoring rubric:
- 95-100% = Exact fabric percentages mentioned in title/features
- 85-94% = Correct base fabrics mentioned (e.g., "Nylon Spandex" or "Polyamide Elastane")
- 75-84% = Performance keywords suggesting similar blend (Moisture Wicking, Tech, Athletic, Quick Dry)
- 60-74% = Generic athletic wear, likely similar but uncertain
- 40-59% = Different fabric blend but same category (e.g., Polyester/Spandex vs Polyamide/Elastane)
- 20-39% = Wrong base fabric (e.g., "100% Polyester" when searching for blends)
- <20% = Completely different material (Cotton, Wool, etc.)

Return ONLY a JSON array with this structure:
[
  {"index": 0, "matchPercentage": 98, "reason": "Title mentions 75% Nylon 25% Spandex - exact match"},
  {"index": 1, "matchPercentage": 35, "reason": "100% Polyester - wrong fabric, blend expected"}
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

    // Add match data to products and boost those with fabric info
    const scoredProducts = products.map((product, idx) => {
      const score = scores.find(s => s.index === idx)

      // Preserve hardcoded match percentages (don't override with Claude scores)
      if (product._hardcoded && product.matchPercentage) {
        return {
          ...product,
          matchReason: `Hardcoded ${product.matchPercentage}% match - ODODOS dupe for Vuori`
        }
      }

      let matchPercentage = score?.matchPercentage || 50
      let matchReason = score?.reason || 'Unable to determine match'

      // BOOST #4: Prioritize products with actual fabric percentages in title/features
      const titleLower = (product.title || '').toLowerCase()
      const featuresLower = (product.features || []).join(' ').toLowerCase()
      const combinedText = `${titleLower} ${featuresLower}`

      // Check for fabric percentage patterns (e.g., "75%", "75 %", "75 percent")
      const hasFabricPercentage = /\d+\s*%|\d+\s*percent/i.test(combinedText)

      // Check for fabric names (Nylon, Polyamide, Polyester, Spandex, Elastane, Cotton)
      const hasFabricName = /(nylon|polyamide|polyester|spandex|elastane|lycra|cotton)/i.test(combinedText)

      if (hasFabricPercentage && hasFabricName) {
        // Product explicitly lists fabric composition - boost by 10 points (capped at 100)
        const boostedScore = Math.min(matchPercentage + 10, 100)
        matchReason = `${matchReason} [+10 boost: fabric % in title]`
        matchPercentage = boostedScore
        console.log(`[Fabric Boost] "${product.title.substring(0, 50)}" boosted from ${matchPercentage - 10}% → ${boostedScore}%`)
      }

      return {
        ...product,
        matchPercentage,
        matchReason
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
  // Set request timeout (60 seconds) to prevent hung requests
  const requestTimeout = setTimeout(() => {
    if (!res.headersSent) {
      console.error('[Timeout] Streaming request exceeded 60 second limit')
      res.status(504).json({
        error: 'Request timeout',
        message: 'Analysis took too long. This could happen if the product page is very complex. Please try again or try a different URL.'
      })
    } else {
      // SSE already started - send error event and close
      try {
        res.write(`event: error\n`)
        res.write(`data: ${JSON.stringify({ message: 'Request timeout - analysis took too long' })}\n\n`)
        res.end()
      } catch (e) {
        // Connection may already be closed
      }
    }
  }, 60000) // 60 second timeout

  try {
    const { url, refresh } = req.body

    if (!url) {
      clearTimeout(requestTimeout)
      return res.status(400).json({ error: 'URL is required' })
    }

    // Validate Lululemon URLs
    if (url.includes('www.lululemon.com/products/')) {
      clearTimeout(requestTimeout)
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

      // FIX: Override product_type if URL contains wideleg/straight leg pant keywords
      let correctedProductType = cachedData.product_type
      const urlLower = url.toLowerCase()
      if (urlLower.includes('wideleg') || (urlLower.includes('pant') && !urlLower.includes('legging'))) {
        correctedProductType = 'pant'
        console.log('[Product Type Override] URL contains wideleg/pant - correcting from "leggings" to "pant"')
      }

      const alternatives = await searchProductAlternatives(
        {
          fabrics: cachedData.fabrics,
          quality_tier: cachedData.quality_tier,
          features: cachedData.features,
          product_type: correctedProductType,
          gender: cachedData.gender,
          keywords: cachedData.keywords,
          product_name: cachedData.product_name
        },
        cachedData.brand,
        correctedProductType || 'athletic wear'
      )

      sendEvent('alternatives', { alternatives })
      sendEvent('complete', { cached: true, cached_at: cachedData.scraped_at })
      clearTimeout(requestTimeout)
      res.end()
      return
    }

    // Step 2: Two-tier scraping - try simple fetch first, fallback to Firecrawl
    sendEvent('status', { step: 'scrape', message: 'Scraping product page...' })
    let scrapedData
    let usedFirecrawl = false

    // Tier 1: Try simple HTTP fetch (cheap)
    const simpleFetchResult = await scrapeWithSimpleFetch(url)

    if (simpleFetchResult.success) {
      console.log('[Scraping] Simple fetch succeeded - no Firecrawl needed!')
      scrapedData = simpleFetchResult
    } else {
      // Tier 2: Fallback to Firecrawl stealth (expensive)
      console.log('[Scraping] Simple fetch failed - using Firecrawl stealth')
      const firecrawlStart = Date.now()
      scrapedData = await scrapeWithFirecrawl(url)
      const firecrawlTime = Date.now() - firecrawlStart
      usedFirecrawl = true

      if (!scrapedData.success) {
        sendEvent('error', { message: sanitizeError('Failed to scrape product page') })
        clearTimeout(requestTimeout)
        res.end()
        return
      }

      await trackApiCall('firecrawl', {
        scanUrl: url,
        responseTime: firecrawlTime,
        status: 'success'
      })
    }

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

    // FIX: Override product_type if URL contains wideleg/straight leg pant keywords
    const urlLower = url.toLowerCase()
    if (urlLower.includes('wideleg') || (urlLower.includes('pant') && !urlLower.includes('legging'))) {
      fabricData.product_type = 'pant'
      console.log('[Product Type Override] URL contains wideleg/pant - correcting to "pant"')
    }

    const searchStart = Date.now()

    // PROGRESSIVE LOADING: Send alternatives in batches
    sendEvent('status', { step: 'search_amazon', message: 'Searching Amazon...' })
    const alternatives = await searchProductAlternativesProgressive(
      fabricData,
      brand,
      fabricData.product_type || 'athletic wear',
      (partialResults, stage) => {
        // Send partial results as they come in
        if (stage === 'amazon') {
          console.log(`[Progressive] Sending ${partialResults.length} Amazon results`)
          sendEvent('alternatives_partial', {
            alternatives: partialResults,
            stage: 'amazon',
            message: `Found ${partialResults.length} Amazon matches...`
          })
        } else if (stage === 'final') {
          console.log(`[Progressive] Sending final ${partialResults.length} results`)
        }
      }
    )
    const searchTime = Date.now() - searchStart

    await trackApiCall('serpapi', {
      scanUrl: url,
      callCount: 6,
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
      serpapiCalls: 6,
      firecrawlCalls: 1,
      totalCost: (1 * 0.015) + (2 * 0.0075) + (6 * 0.0036),
      scanTime: totalTime
    })

    // Send final alternatives and complete
    sendEvent('alternatives', { alternatives })
    sendEvent('complete', { cached: false, scanTime: totalTime })
    clearTimeout(requestTimeout)
    res.end()

    // Increment scan count after successful scan (don't await - fire and forget)
    if (req.userTracking && !req.isAdmin) {
      incrementUserScanCount(req.userTracking.userId, req.userTracking.fingerprint)
        .catch(err => console.error('[Scan Count Increment Error]:', err))
    }

  } catch (error) {
    clearTimeout(requestTimeout)
    console.error('[Streaming API Error]:', error) // Full error logged server-side
    try {
      res.write(`event: error\n`)
      res.write(`data: ${JSON.stringify({ message: sanitizeError(error) })}\n\n`) // Generic error sent to client
      res.end()
    } catch (e) {
      // Connection may already be closed
    }
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

// Clear cache endpoint (dev only)
app.delete('/api/cache/:pattern', async (req, res) => {
  try {
    const pattern = req.params.pattern
    const { data, error } = await supabase
      .from('products_cache')
      .delete()
      .ilike('url', `%${pattern}%`)
      .select()

    if (error) throw error

    res.json({
      success: true,
      deleted: data?.length || 0,
      message: `Cleared ${data?.length || 0} cached entries matching "${pattern}"`
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ============================================================================
// ADMIN ACCESS ROUTES
// ============================================================================

/**
 * Admin verification endpoint
 * Usage: fabricfinder.fit/admin?key=YOUR_SECRET_KEY
 * Sets httpOnly cookie that persists for 90 days
 */
app.post('/api/admin/verify', adminAuthLimiter, (req, res) => {
  // Require HTTPS in production
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.status(403).json({
      error: 'Admin access requires HTTPS'
    })
  }

  const { key } = req.body

  if (!key || !isValidAdminKey(key)) {
    // Log failed attempt with IP and timestamp
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
    console.log(`[ADMIN] Failed authentication attempt from IP: ${clientIp} at ${new Date().toISOString()}`)

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

  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown'
  console.log(`[ADMIN] Admin access granted to IP: ${clientIp} at ${new Date().toISOString()}`)

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

/**
 * Dashboard endpoint - serves dashboard with environment variables injected
 * Access: /dashboard (requires admin authentication)
 */
app.get('/dashboard', (req, res) => {
  // Check if user is admin
  const isAdmin = req.cookies.admin_session === 'true'

  if (!isAdmin) {
    const adminUrl = process.env.NODE_ENV === 'production'
      ? 'https://fabric-finder.onrender.com?key=YOUR_ADMIN_KEY'
      : 'http://localhost:5173?key=YOUR_ADMIN_KEY'

    return res.status(403).send(`
      <!DOCTYPE html>
      <html>
      <head><title>Access Denied</title></head>
      <body style="font-family: system-ui; background: #000; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
        <div style="text-align: center;">
          <h1>🔒 Access Denied</h1>
          <p>This dashboard requires admin authentication.</p>
          <a href="${adminUrl}" style="color: #00F5FF;">Login as Admin</a>
        </div>
      </body>
      </html>
    `)
  }

  try {
    // Read dashboard HTML and inject environment variables
    const dashboardPath = path.join(__dirname, '../dashboard/index.html')
    let html = fs.readFileSync(dashboardPath, 'utf8')

    // Replace hardcoded credentials with environment variables
    html = html.replace(
      /const SUPABASE_URL = '[^']*'/,
      `const SUPABASE_URL = '${process.env.SUPABASE_URL}'`
    )
    html = html.replace(
      /const SUPABASE_ANON_KEY = '[^']*'/,
      `const SUPABASE_ANON_KEY = '${process.env.SUPABASE_ANON_KEY}'`
    )

    res.setHeader('Content-Type', 'text/html')
    res.send(html)
  } catch (error) {
    // Log errors only in development
    if (process.env.NODE_ENV !== 'production') {
      console.error('[Dashboard] Error:', error)
    }
    res.status(500).send('Error loading dashboard')
  }
})

console.log('[Server] Dashboard route registered at /dashboard')

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  const clientDistPath = path.join(__dirname, '../client/dist')
  app.use(express.static(clientDistPath))

  // Catch-all route for React Router - must be LAST
  // Exclude API routes and dashboard
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api') || req.path === '/dashboard') {
      return res.status(404).send('Not Found')
    }
    res.sendFile(path.join(clientDistPath, 'index.html'))
  })
}

// Development fallback
if (process.env.NODE_ENV !== 'production') {
  app.get('*', (req, res) => {
    res.status(404).send('Not Found')
  })
}

app.listen(PORT, () => {
  console.log(`🚀 Fabric Finder server running on http://localhost:${PORT}`)
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`)
})

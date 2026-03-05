#!/usr/bin/env node

/**
 * Batch Scraper for Fabric Finder
 *
 * Pre-populates cache with popular products from Alo, Lululemon, Vuori, Skims
 * Run overnight to build up cache: node server/batch-scrape.js
 *
 * Usage:
 *   node server/batch-scrape.js              # Scrape all brands
 *   node server/batch-scrape.js lululemon    # Scrape just Lululemon
 *   node server/batch-scrape.js --limit 5    # Scrape first 5 from each brand
 */

import dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import FirecrawlApp from '@mendable/firecrawl-js'
import { createClient } from '@supabase/supabase-js'

dotenv.config()

// Initialize clients
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
})

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_API_KEY,
})

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY
)

// Popular products to pre-cache (add more as needed)
const PRODUCT_URLS = {
  lululemon: [
    'https://shop.lululemon.com/p/women-pants/Align-Pant-2/_/prod8780551',
    'https://shop.lululemon.com/p/women-sports-bras/Energy-Bra/_/prod8555344',
    'https://shop.lululemon.com/p/men-shorts/Pace-Breaker-Short-Linerless/_/prod8910058',
    'https://shop.lululemon.com/p/mens-trousers/ABC-Jogger/_/prod8530558',
    'https://shop.lululemon.com/p/women-tanks/Align-Tank/_/prod9600539',
    'https://shop.lululemon.com/p/men-ss-tops/Metal-Vent-Tech-Short-Sleeve-Shirt-20/_/prod10440118',
    'https://shop.lululemon.com/p/women-jackets-and-hoodies-hoodies/Scuba-Hoodie-Light-Cotton-Fleece/_/prod9960807',
    'https://shop.lululemon.com/p/women-shorts/Hotty-Hot-Short-HR/_/prod9360058',
  ],
  alo: [
    'https://www.aloyoga.com/products/w5514r-womens-airlift-legging-black',
    'https://www.aloyoga.com/products/w9236r-womens-glam-bra-black',
    'https://www.aloyoga.com/products/w3464r-womens-cropped-define-jacket-black',
    'https://www.aloyoga.com/products/w5473r-womens-high-waist-flutter-legging-black',
    'https://www.aloyoga.com/products/m5201r-mens-triumph-short-sleeve-tee-white',
  ],
  vuori: [
    'https://vuoriclothing.com/products/mens-meta-pant-charcoal-heather',
    'https://vuoriclothing.com/products/womens-performance-jogger-black',
    'https://vuoriclothing.com/products/womens-daily-legging-black',
    'https://vuoriclothing.com/products/mens-strato-tech-tee-white',
    'https://vuoriclothing.com/products/womens-clementine-tank-black',
  ],
  skims: [
    'https://skims.com/products/fits-everybody-square-neck-bra-onyx',
    'https://skims.com/products/fits-everybody-high-waist-legging-onyx',
    'https://skims.com/products/soft-lounge-long-slip-dress-onyx',
    'https://skims.com/products/cotton-rib-tank-onyx',
    'https://skims.com/products/seamless-sculpt-brief-bodysuit-onyx',
    'https://skims.com/products/everyday-sculpt-bodysuit-onyx',
    'https://skims.com/products/seamless-sculpt-thong-bodysuit-onyx',
  ],
  csb: [
    'https://www.shopcsb.com/products/serenity-crossover-leggings-navy',
    'https://www.shopcsb.com/products/serenity-naomi-crop-navy',
    'https://www.shopcsb.com/products/serenity-crossover-4-inch-shorts-navy',
    'https://www.shopcsb.com/products/serenity-elsie-tank-navy',
    'https://www.shopcsb.com/products/off-shoulder-wrap-top-navy',
  ],
  patagonia: [
    'https://www.patagonia.com/product/womens-capilene-midweight-baselayer-bottoms/44492.html',
    'https://www.patagonia.com/product/womens-capilene-thermal-weight-baselayer-bottoms/43692.html',
    'https://www.patagonia.com/product/womens-capilene-cool-daily-hoody/45316.html',
    'https://www.patagonia.com/product/womens-capilene-cool-daily-shirt/45226.html',
    'https://www.patagonia.com/product/womens-capilene-thermal-weight-boot-length-baselayer-bottoms/43695.html',
  ],
}

// Utility: Normalize URL
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url)
    return `${urlObj.origin}${urlObj.pathname}`.replace(/\/$/, '')
  } catch {
    return url
  }
}

// Utility: Extract brand from URL
function extractBrand(url) {
  const brandMap = {
    'lululemon.com': 'Lululemon',
    'aloyoga.com': 'Alo Yoga',
    'vuoriclothing.com': 'Vuori',
    'skims.com': 'Skims',
    'shopcsb.com': 'CSB',
    'patagonia.com': 'Patagonia',
  }

  for (const [domain, brand] of Object.entries(brandMap)) {
    if (url.includes(domain)) return brand
  }
  return 'Unknown'
}

// Check if URL is already cached and still valid
async function isAlreadyCached(url) {
  const normalizedUrl = normalizeUrl(url)

  try {
    const { data, error } = await supabase
      .from('products_cache')
      .select('*')
      .or(`url.eq.${url},product_url_normalized.eq.${normalizedUrl}`)
      .limit(1)
      .single()

    if (error || !data) return false

    // Check if cache has expired (7 days)
    const expiresAt = new Date(data.expires_at)
    const now = new Date()

    if (expiresAt < now) {
      console.log(`  ⚠️  Cache expired (${data.scraped_at})`)
      return false
    }

    return true
  } catch {
    return false
  }
}

// Scrape with Firecrawl (same logic as server)
async function scrapeWithFirecrawl(url) {
  console.log(`  🔍 Scraping...`)

  const useJsonExtraction = url.includes('aloyoga.com') || url.includes('lululemon.com') || url.includes('gymshark.com')
  const needsStealth = useJsonExtraction || url.includes('patagonia.com') || url.includes('skims.com')

  try {
    if (useJsonExtraction) {
      const brand = url.includes('aloyoga.com') ? 'Alo Yoga' : url.includes('gymshark.com') ? 'Gymshark' : 'Lululemon'
      console.log(`  📦 Using JSON extraction for ${brand}`)

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
        console.error('  ❌ JSON extraction failed')
        return { success: false, error: 'Failed to extract product data' }
      }

      console.log(`  ✅ JSON extraction successful`)
      return {
        success: true,
        content: null,
        fabricData: scrapeResult.json,
        url
      }
    }

    // Standard markdown extraction
    const scrapeOptions = {
      formats: ['markdown'],
      onlyMainContent: true,
      waitFor: 10000,
      timeout: 60000,
    }

    if (needsStealth) {
      scrapeOptions.proxy = 'stealth'
      scrapeOptions.mobile = true
      console.log(`  🥷 Using STEALTH mode`)
    }

    const scrapeResult = await firecrawl.scrape(url, scrapeOptions)

    if (!scrapeResult || !scrapeResult.markdown) {
      console.error('  ❌ Scrape failed: No content returned')
      return { success: false, error: 'Failed to scrape page' }
    }

    const contentLength = scrapeResult.markdown.length
    console.log(`  ✅ Success - Content length: ${contentLength} chars`)

    return {
      success: true,
      content: scrapeResult.markdown,
      url
    }
  } catch (error) {
    console.error('  ❌ Firecrawl Error:', error.message)
    return { success: false, error: error.message }
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
9. Extract performance keywords from product title/description (Tech, Performance, Moisture Wicking, Quick Dry, UPF, Dry Fit, Cooling, Athletic, etc.)

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

Product page content:
${scrapedContent}

Return ONLY the JSON object, no other text.`

  try {
    console.log('  🤖 Extracting with Claude...')

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    })

    let responseText = message.content[0].text
    responseText = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim()
    const fabricData = JSON.parse(responseText)

    console.log(`  ✅ Extracted: ${fabricData.product_name}`)
    return fabricData
  } catch (error) {
    console.error('  ❌ Claude API Error:', error.message)
    throw new Error('Failed to extract fabric composition')
  }
}

// Save product data to cache
async function saveToCache(url, fabricData) {
  const normalizedUrl = normalizeUrl(url)
  const brand = extractBrand(url)

  const now = new Date()
  const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000) // 7 days

  try {
    const { error } = await supabase
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

    if (error) {
      console.error('  ❌ Cache Error:', error.message)
      return false
    } else {
      console.log('  💾 Saved to cache')
      return true
    }
  } catch (error) {
    console.error('  ❌ Cache Error:', error.message)
    return false
  }
}

// Sleep function for rate limiting
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Main batch scrape function
async function batchScrape(options = {}) {
  const { brands = ['lululemon', 'alo', 'vuori', 'skims'], limit = null, skipCached = true } = options

  console.log('🚀 Starting Batch Scraper')
  console.log(`📋 Brands: ${brands.join(', ')}`)
  console.log(`🔢 Limit: ${limit || 'all'}`)
  console.log(`⏩ Skip cached: ${skipCached}\n`)

  let totalProcessed = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const brand of brands) {
    const urls = PRODUCT_URLS[brand] || []

    if (urls.length === 0) {
      console.log(`⚠️  No URLs configured for ${brand}`)
      continue
    }

    console.log(`\n${'='.repeat(60)}`)
    console.log(`📦 Processing ${brand.toUpperCase()} (${urls.length} products)`)
    console.log(`${'='.repeat(60)}\n`)

    const urlsToProcess = limit ? urls.slice(0, limit) : urls

    for (let i = 0; i < urlsToProcess.length; i++) {
      const url = urlsToProcess[i]
      console.log(`[${i + 1}/${urlsToProcess.length}] ${url}`)

      try {
        // Check if already cached
        if (skipCached) {
          const cached = await isAlreadyCached(url)
          if (cached) {
            console.log('  ✅ Already cached - skipping')
            totalSkipped++
            continue
          }
        }

        // Scrape
        const scrapedData = await scrapeWithFirecrawl(url)

        if (!scrapedData.success) {
          console.error(`  ❌ Scrape failed: ${scrapedData.error}`)
          totalErrors++
          continue
        }

        // Extract fabric data
        let fabricData

        if (scrapedData.fabricData) {
          fabricData = scrapedData.fabricData
          console.log('  ✅ Using JSON-extracted data')
        } else {
          fabricData = await extractFabricComposition(scrapedData.content)
        }

        // Save to cache
        const saved = await saveToCache(url, fabricData)

        if (saved) {
          totalProcessed++
          console.log(`  ✅ Complete\n`)
        } else {
          totalErrors++
          console.log(`  ❌ Failed to save\n`)
        }

        // Rate limiting: 5 second delay between products (avoid hammering APIs)
        if (i < urlsToProcess.length - 1) {
          console.log('  ⏳ Waiting 5 seconds...\n')
          await sleep(5000)
        }

      } catch (error) {
        console.error(`  ❌ Error processing ${url}:`, error.message)
        totalErrors++
      }
    }
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('📊 BATCH SCRAPE COMPLETE')
  console.log(`${'='.repeat(60)}`)
  console.log(`✅ Processed: ${totalProcessed}`)
  console.log(`⏩ Skipped: ${totalSkipped}`)
  console.log(`❌ Errors: ${totalErrors}`)
  console.log(`📦 Total cache entries: ${totalProcessed + totalSkipped}`)
  console.log('')
}

// Parse CLI arguments
const args = process.argv.slice(2)
const options = {
  brands: ['lululemon', 'alo', 'vuori', 'skims', 'csb', 'patagonia'],
  limit: null,
  skipCached: true
}

// Parse brand filter (e.g., "node batch-scrape.js lululemon")
if (args.length > 0 && !args[0].startsWith('--')) {
  const brand = args[0].toLowerCase()
  if (PRODUCT_URLS[brand]) {
    options.brands = [brand]
  } else {
    console.error(`❌ Unknown brand: ${brand}`)
    console.log(`Available brands: ${Object.keys(PRODUCT_URLS).join(', ')}`)
    process.exit(1)
  }
}

// Parse --limit flag
const limitIndex = args.indexOf('--limit')
if (limitIndex !== -1 && args[limitIndex + 1]) {
  options.limit = parseInt(args[limitIndex + 1], 10)
}

// Parse --force flag (skip cache check)
if (args.includes('--force')) {
  options.skipCached = false
}

// Run batch scraper
batchScrape(options).catch(error => {
  console.error('\n❌ Fatal error:', error)
  process.exit(1)
})

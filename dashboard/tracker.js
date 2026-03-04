/**
 * API Usage Tracker for Fabric Finder
 * Non-blocking middleware to log API calls to Supabase
 *
 * Usage in server.js:
 * import { trackApiCall, printApiSummary } from './dashboard/tracker.js'
 *
 * After any API call:
 * trackApiCall('claude', { scanUrl, cost: 0.015, responseTime: 1234, status: 'success' })
 */

import { createClient } from '@supabase/supabase-js'

// Lazy-load Supabase client (initialized on first use)
let supabase = null
function getSupabase() {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_KEY
    )
  }
  return supabase
}

// Cost models (per single call/request)
const API_COSTS = {
  claude: 0.0075,      // ~$0.015 per scan (2 calls)
  serpapi: 0.0036,     // ~$0.018 per scan (5 searches)
  firecrawl: 0.015,    // ~$0.015 per scan (1 scrape)
  amazonPaapi: 0,      // Free for approved associates (requires 3 sales/180 days)
  supabase: 0          // Free tier
}

/**
 * Track an API call
 * @param {string} apiName - 'claude' | 'serpapi' | 'firecrawl' | 'amazonPaapi' | 'supabase'
 * @param {object} options
 * @param {string} options.scanUrl - The product URL being scanned
 * @param {number} options.callCount - How many times this API was called (default: 1)
 * @param {number} options.cost - Estimated cost (auto-calculated if not provided)
 * @param {number} options.responseTime - Response time in milliseconds
 * @param {string} options.status - 'success' | 'error' | 'cached'
 * @param {number} options.tokensUsed - For Claude only
 * @param {object} options.metadata - Any additional data
 */
export async function trackApiCall(apiName, options = {}) {
  try {
    const {
      scanUrl = 'unknown',
      callCount = 1,
      cost,
      responseTime = null,
      status = 'success',
      tokensUsed = null,
      metadata = {}
    } = options

    // Calculate cost if not provided
    const estimatedCost = cost ?? (API_COSTS[apiName] * callCount)

    // Insert into Supabase (non-blocking, fire-and-forget)
    const { error } = await getSupabase()
      .from('api_tracking')
      .insert({
        scan_url: scanUrl,
        api_name: apiName,
        call_count: callCount,
        estimated_cost: estimatedCost,
        response_time_ms: responseTime,
        status,
        tokens_used: tokensUsed,
        metadata
      })

    if (error) {
      console.error('[Tracker] Failed to log API call:', error.message)
    }
  } catch (err) {
    // Never throw - tracking failures should not break the app
    console.error('[Tracker] Unexpected error:', err.message)
  }
}

/**
 * Print a summary table to console after scan completes
 * @param {object} scanData - Data from the completed scan
 */
export function printApiSummary(scanData) {
  const {
    claudeCalls = 0,
    serpapiCalls = 0,
    firecrawlCalls = 0,
    amazonPaapiCalls = 0,
    totalCost = 0,
    scanTime = 0
  } = scanData

  console.log('\n' + '='.repeat(60))
  console.log('  API USAGE SUMMARY')
  console.log('='.repeat(60))
  console.table([
    {
      API: 'Claude',
      Calls: claudeCalls,
      Cost: `$${(claudeCalls * API_COSTS.claude).toFixed(4)}`
    },
    {
      API: 'SerpAPI',
      Calls: serpapiCalls,
      Cost: `$${(serpapiCalls * API_COSTS.serpapi).toFixed(4)}`
    },
    {
      API: 'Firecrawl',
      Calls: firecrawlCalls,
      Cost: `$${(firecrawlCalls * API_COSTS.firecrawl).toFixed(4)}`
    },
    {
      API: 'Amazon PAAPI',
      Calls: amazonPaapiCalls,
      Cost: amazonPaapiCalls > 0 ? 'FREE' : '$0.0000'
    },
    {
      API: 'TOTAL',
      Calls: claudeCalls + serpapiCalls + firecrawlCalls + amazonPaapiCalls,
      Cost: `$${totalCost.toFixed(4)}`
    }
  ])
  console.log(`  Scan completed in ${(scanTime / 1000).toFixed(2)}s`)
  console.log('='.repeat(60) + '\n')
}

/**
 * Helper: Get today's total cost
 */
export async function getTodaysCost() {
  try {
    const { data, error } = await getSupabase()
      .from('api_tracking')
      .select('estimated_cost')
      .gte('created_at', new Date().toISOString().split('T')[0])

    if (error) throw error

    return data.reduce((sum, row) => sum + parseFloat(row.estimated_cost), 0)
  } catch (err) {
    console.error('[Tracker] Failed to get today\'s cost:', err.message)
    return 0
  }
}

/**
 * Helper: Get SerpAPI usage for the month (to track 250 free tier limit)
 */
export async function getSerpApiUsageThisMonth() {
  try {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)

    const { data, error } = await getSupabase()
      .from('api_tracking')
      .select('call_count')
      .eq('api_name', 'serpapi')
      .gte('created_at', startOfMonth.toISOString())

    if (error) throw error

    return data.reduce((sum, row) => sum + row.call_count, 0)
  } catch (err) {
    console.error('[Tracker] Failed to get SerpAPI usage:', err.message)
    return 0
  }
}

export default {
  trackApiCall,
  printApiSummary,
  getTodaysCost,
  getSerpApiUsageThisMonth
}

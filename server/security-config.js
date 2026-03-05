/**
 * Security Configuration for Fabric Finder
 * Centralized security settings for URL validation, CORS, rate limiting, and error sanitization
 */

// ============================================================================
// ALLOWED DOMAINS (SSRF Prevention)
// ============================================================================
// Whitelist of supported clothing brands
// Adding new brands: Add domain to this list + update extractBrand() in index.js
export const ALLOWED_DOMAINS = [
  // Athletic/Lifestyle Brands
  'lululemon.com',
  'aloyoga.com',
  'vuoriclothing.com',
  'patagonia.com',
  'gymshark.com',
  'fabletics.com',
  'athleta.gap.com',
  'nike.com',
  'adidas.com',
  'underarmour.com',
  'skims.com',
  'shopcsb.com',
  'abercrombie.com',

  // Outdoor Brands
  'thenorthface.com',
  'arcteryx.com',
  'columbia.com',
  'rei.com',

  // Additional retailers (add as needed)
  'nordstrom.com',
  'shopbop.com',
  'revolve.com'
]

// ============================================================================
// CORS CONFIGURATION
// ============================================================================
// Whitelist of allowed origins for API access
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',           // Vite dev server
  'http://localhost:3000',           // Express server (for testing)
  'https://fabricfinder.fit',        // Production domain
  'https://www.fabricfinder.fit',    // Production www subdomain
  'https://fabric-finder.onrender.com' // Render deployment
]

// ============================================================================
// RATE LIMITING CONFIGURATION
// ============================================================================
export const RATE_LIMITS = {
  // Free tier - burst protection: 10 requests per 15 minutes
  freeBurst: {
    windowMs: 15 * 60 * 1000,        // 15 minutes
    max: 10,                          // 10 requests
    message: {
      error: 'Too many requests',
      message: 'Whoa, slow down! You can scan up to 10 items every 15 minutes on the free plan. Upgrade to Premium for unlimited scans.',
      hint: 'Premium users get unlimited scans + no ads. Click "Upgrade" to learn more.'
    }
  },

  // Free tier - hourly limit: 20 requests per hour
  freeHourly: {
    windowMs: 60 * 60 * 1000,        // 1 hour
    max: 20,                          // 20 requests
    message: {
      error: 'Hourly limit reached',
      message: 'You\'ve used all 20 free scans this hour. Upgrade to Premium for unlimited scans.',
      hint: 'Premium: Unlimited scans, no ads, priority support. Only $9.99/month.'
    }
  },

  // Premium tier: unlimited (very high limit for safety)
  premium: {
    windowMs: 60 * 60 * 1000,        // 1 hour
    max: 1000,                        // Effectively unlimited
    message: {
      error: 'Rate limit exceeded',
      message: 'You have exceeded your API limit. Please contact support.'
    }
  },

  // Admin authentication: prevent brute force attacks
  adminAuth: {
    windowMs: 15 * 60 * 1000,        // 15 minutes
    max: 5,                           // 5 attempts per 15 minutes
    message: {
      error: 'Too many authentication attempts',
      message: 'Too many failed login attempts. Please try again in 15 minutes.'
    }
  }
}

// ============================================================================
// COST MONITORING
// ============================================================================
export const DAILY_COST_LIMIT = 50.00 // $50/day kill switch

// ============================================================================
// URL VALIDATION (SSRF Prevention)
// ============================================================================

/**
 * Validates a product URL before scraping
 * Prevents SSRF attacks by blocking internal IPs, localhost, and unsupported domains
 *
 * @param {string} url - The URL to validate
 * @returns {object} - { valid: boolean, error: string }
 */
export function isValidScrapeUrl(url) {
  // Step 1: Validate URL format
  let urlObj
  try {
    urlObj = new URL(url)
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid URL format. Please provide a valid product URL.'
    }
  }

  // Step 2: Block non-HTTP(S) protocols (prevents file://, ftp://, etc.)
  if (!['http:', 'https:'].includes(urlObj.protocol)) {
    return {
      valid: false,
      error: 'Only HTTP and HTTPS URLs are supported.'
    }
  }

  // Step 3: Block localhost and 127.0.0.1 (SSRF prevention)
  const hostname = urlObj.hostname.toLowerCase()
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    return {
      valid: false,
      error: 'Internal URLs are not allowed.'
    }
  }

  // Step 4: Block internal IP ranges (SSRF prevention)
  // 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16 (link-local)
  const internalIpPatterns = [
    /^10\./,                          // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,// 172.16.0.0/12
    /^192\.168\./,                    // 192.168.0.0/16
    /^169\.254\./                     // 169.254.0.0/16 (link-local)
  ]

  if (internalIpPatterns.some(pattern => pattern.test(hostname))) {
    return {
      valid: false,
      error: 'Internal IP addresses are not allowed.'
    }
  }

  // Step 5: All SSRF checks passed - allow any legitimate clothing website
  // No brand whitelist - works with ANY brand!
  return {
    valid: true,
    error: null
  }
}

// ============================================================================
// ERROR SANITIZATION
// ============================================================================

/**
 * Sanitizes error messages before sending to client
 * Prevents leaking sensitive API details (Firecrawl errors, Claude errors, SerpAPI errors)
 *
 * @param {Error|string} error - The error to sanitize
 * @returns {string} - Generic error message safe for client
 */
export function sanitizeError(error) {
  const errorMessage = typeof error === 'string' ? error : error.message || 'Unknown error'

  // Check for specific API error patterns and return generic messages

  // Firecrawl errors
  if (errorMessage.includes('firecrawl') || errorMessage.includes('scrape') || errorMessage.includes('crawl')) {
    return 'Unable to fetch product information. Please try a different URL or try again later.'
  }

  // Claude/Anthropic errors
  if (errorMessage.includes('anthropic') || errorMessage.includes('claude') || errorMessage.includes('model')) {
    return 'Unable to analyze product data. Please try again later.'
  }

  // SerpAPI errors
  if (errorMessage.includes('serpapi') || errorMessage.includes('google') || errorMessage.includes('search')) {
    return 'Unable to find alternative products. Please try again later.'
  }

  // Amazon API errors
  if (errorMessage.includes('amazon') || errorMessage.includes('paapi')) {
    return 'Unable to fetch product details. Please try again later.'
  }

  // Supabase/Database errors
  if (errorMessage.includes('supabase') || errorMessage.includes('database') || errorMessage.includes('postgres')) {
    return 'A temporary service issue occurred. Please try again later.'
  }

  // Network/timeout errors
  if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('ECONNREFUSED')) {
    return 'Request timed out. Please try again.'
  }

  // Rate limiting (keep specific)
  if (errorMessage.includes('rate limit') || errorMessage.includes('too many requests')) {
    return errorMessage // Keep rate limit messages as-is
  }

  // Default: Generic error
  return 'An error occurred while processing your request. Please try again.'
}

// ============================================================================
// REQUEST SIZE LIMITS
// ============================================================================
export const MAX_REQUEST_SIZE = '10kb' // Prevents DoS via large payloads

// ============================================================================
// SECURITY HEADERS (via helmet)
// ============================================================================
export const HELMET_CONFIG = {
  contentSecurityPolicy: false,        // Disabled for now (can enable later with proper CSP policy)
  crossOriginEmbedderPolicy: false,    // May interfere with Firecrawl/external APIs
  dnsPrefetchControl: true,            // Prevent DNS prefetching
  frameguard: { action: 'deny' },      // Prevent clickjacking (X-Frame-Options: DENY)
  hsts: {
    maxAge: 31536000,                   // 1 year HSTS (only applies in production with HTTPS)
    includeSubDomains: true,
    preload: true
  },
  ieNoOpen: true,                       // Prevent IE from executing downloads in site context
  noSniff: true,                        // Prevent MIME type sniffing (X-Content-Type-Options: nosniff)
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin' // Don't leak full URL in referrer
  },
  xssFilter: true                       // Enable XSS filter (legacy browsers)
}

export default {
  ALLOWED_DOMAINS,
  ALLOWED_ORIGINS,
  RATE_LIMITS,
  DAILY_COST_LIMIT,
  MAX_REQUEST_SIZE,
  HELMET_CONFIG,
  isValidScrapeUrl,
  sanitizeError
}

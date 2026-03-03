-- ============================================================================
-- PRODUCTS CACHE TABLE SCHEMA
-- ============================================================================
--
-- This schema creates the products_cache table for Fabric Finder.
-- Run this in Supabase SQL Editor before deploying to production.
--
-- Purpose: Store scraped product data to avoid re-scraping (cache hits ~50x faster)
-- Cache expiry: 7 days (configurable via expires_at timestamp)
--
-- IMPORTANT: Indexes are critical for O(1) lookup performance
--            Without indexes, cache lookups will be O(n) table scans
-- ============================================================================

-- Create products_cache table if it doesn't exist
CREATE TABLE IF NOT EXISTS products_cache (
  id BIGSERIAL PRIMARY KEY,
  url TEXT NOT NULL,                          -- Original URL (with query params)
  product_url_normalized TEXT NOT NULL,       -- Normalized URL (for cache matching)
  product_name TEXT,                          -- Extracted product name
  fabrics JSONB,                              -- Fabric composition array
  alternatives JSONB,                         -- Alternative products array
  scraped_at TIMESTAMPTZ DEFAULT NOW(),       -- When this was cached
  expires_at TIMESTAMPTZ,                     -- Cache expiration timestamp
  cache_hits INTEGER DEFAULT 0                -- How many times this cache entry was used
);

-- ============================================================================
-- INDEXES (Critical for Performance)
-- ============================================================================

-- Index on original URL (for exact URL lookups)
-- Used when checking if URL exists in cache
CREATE INDEX IF NOT EXISTS idx_products_cache_url ON products_cache(url);

-- Index on normalized URL (primary cache lookup)
-- Normalized URLs strip query params for better cache hit rate
-- This is the MOST IMPORTANT index - used on every cache check
CREATE INDEX IF NOT EXISTS idx_products_cache_normalized ON products_cache(product_url_normalized);

-- Index on expiration timestamp (for cache cleanup)
-- Used to efficiently find and delete expired cache entries
CREATE INDEX IF NOT EXISTS idx_products_cache_expires ON products_cache(expires_at);

-- Composite index for cache cleanup queries (optional but recommended)
-- Helps with queries that check both expiration and hit count
CREATE INDEX IF NOT EXISTS idx_products_cache_cleanup ON products_cache(expires_at, cache_hits);

-- ============================================================================
-- VERIFICATION QUERIES
-- ============================================================================
--
-- After running this schema, verify it worked:
--
-- 1. Check table exists:
--    SELECT * FROM products_cache LIMIT 1;
--
-- 2. Check indexes exist:
--    SELECT indexname, indexdef
--    FROM pg_indexes
--    WHERE tablename = 'products_cache';
--
-- 3. Test cache lookup performance (should be <10ms):
--    EXPLAIN ANALYZE
--    SELECT * FROM products_cache
--    WHERE product_url_normalized = 'https://shop.lululemon.com/p/women-pants/align-hr-pant-28';
--
-- ============================================================================
-- DATA RETENTION POLICY
-- ============================================================================
--
-- Recommended: Schedule weekly cleanup to delete expired entries older than 30 days
--
-- DELETE FROM products_cache
-- WHERE expires_at < NOW() - INTERVAL '30 days';
--
-- Can be automated via Supabase Edge Function or cron job
-- ============================================================================

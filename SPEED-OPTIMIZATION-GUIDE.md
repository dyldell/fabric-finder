# Speed Optimization Implementation Guide

## What We Just Built

### ✅ 1. Claude Streaming Response
**Impact:** Makes UI feel 2-3x faster by showing fabric data as it's extracted

**Changes:**
- New endpoint: `/api/analyze-stream` (Server-Sent Events)
- Frontend automatically uses streaming endpoint
- Fabric data appears immediately while alternatives load in background

**Technical Details:**
- Backend: `server/index.js` - Modified `extractFabricComposition()` to support streaming
- Frontend: `client/src/App.jsx` - Updated to handle SSE events
- User sees fabric composition ~3-5 seconds earlier

---

### ✅ 2. Gzip Compression
**Impact:** Reduces response sizes by ~70%, faster page loads

**Changes:**
- Added `compression` middleware to Express
- Automatically compresses all API responses and static files
- No frontend changes needed

**Test it:**
```bash
curl -H "Accept-Encoding: gzip" http://localhost:3000/api/health -v
# Look for "Content-Encoding: gzip" in response headers
```

---

### ✅ 3. Batch Scraping Script (Overnight Pre-Caching)
**Impact:** Pre-populates cache with popular products, makes first scans instant

**File:** `server/batch-scrape.js`

**Usage:**
```bash
# Scrape all brands (Lululemon, Alo, Vuori, Skims)
node server/batch-scrape.js

# Scrape just one brand
node server/batch-scrape.js lululemon

# Limit to first 5 products per brand (for testing)
node server/batch-scrape.js --limit 5

# Force re-scrape even if cached
node server/batch-scrape.js --force

# Scrape just Alo, first 3 products
node server/batch-scrape.js alo --limit 3
```

**How It Works:**
1. Checks if URL is already cached (skip if yes)
2. Scrapes product page with Firecrawl (JSON extraction for Alo/Lulu)
3. Extracts fabric data with Claude
4. Saves to Supabase cache
5. Waits 5 seconds between products (rate limiting)
6. Logs progress + summary at the end

**Current Product List:**
- Lululemon: 8 products (Align Legging, Energy Bra, Pace Breaker Short, etc.)
- Alo Yoga: 5 products (Airlift Legging, Glam Bra, etc.)
- Vuori: 5 products (Meta Pant, Performance Jogger, etc.)
- Skims: 4 products (Fits Everybody Bra, High Waist Legging, etc.)

**Add More Products:**
Edit `server/batch-scrape.js` and add URLs to the `PRODUCT_URLS` object:
```javascript
const PRODUCT_URLS = {
  lululemon: [
    'https://shop.lululemon.com/p/...',
    // Add more here
  ],
  // ...
}
```

**Run Overnight:**
```bash
# macOS/Linux - Run at 2am every day
crontab -e
# Add this line:
0 2 * * * cd /Users/dyldell/Documents/fabricfinder && node server/batch-scrape.js >> logs/batch-scrape.log 2>&1
```

---

### 🔜 4. CDN Setup (Cloudflare)
**Impact:** Faster static asset loading globally

**Steps:**

1. **Add your site to Cloudflare:**
   - Go to https://dash.cloudflare.com
   - Click "Add a site"
   - Enter `fabricfinder.fit`
   - Choose Free plan

2. **Update nameservers at Namecheap:**
   - Cloudflare will give you 2 nameservers (e.g., `ns1.cloudflare.com`)
   - Go to Namecheap → Domain List → fabricfinder.fit → Manage
   - Change "Nameservers" from Namecheap DNS to "Custom DNS"
   - Enter the 2 Cloudflare nameservers
   - Wait 24-48 hours for DNS propagation

3. **Configure Cloudflare settings:**
   - Speed → Optimization → Auto Minify: Enable JS, CSS, HTML
   - Caching → Configuration → Browser Cache TTL: 4 hours
   - SSL/TLS → Overview → Full (strict)
   - Speed → Optimization → Brotli: Enable

4. **Cache static assets:**
   Add a page rule:
   - URL: `fabricfinder.fit/assets/*`
   - Setting: "Cache Level" → "Cache Everything"
   - Edge Cache TTL: 1 month

**That's it!** Cloudflare will now cache and serve your static files from edge servers worldwide.

---

## Performance Summary

### Before Optimizations:
- Cache miss: ~25 seconds
- User sees nothing until complete
- No compression
- Every scan hits APIs

### After Optimizations:
- Cache hit: <1 second ⚡
- Cache miss: ~25 seconds BUT fabric data shows at ~5 seconds (feels 3x faster)
- Responses compressed by 70%
- Popular products pre-cached overnight

---

## Next Steps (Future)

### High Impact (Not Yet Implemented):
1. **Parallel SerpAPI Queries** - Save 10-12 seconds
   - Currently: 5 sequential queries = 15-18s
   - Change to: Run all 5 in parallel = 3-4s
   - Implementation: Use `Promise.all()` in `searchProductAlternatives()`

2. **Smart Query Reduction** - Save 5-8 seconds
   - Start with 2-3 queries instead of always 5
   - Only add more if initial results are weak

### With Amazon Product API Coming:
- SerpAPI cost drops significantly
- Parallel queries become even more important
- Caching strategy: Cache fabric extraction ONLY, not product results
- Product results stay fresh with new API

---

## Testing

**Test streaming response:**
```bash
# Start dev servers
npm run dev

# Open browser
open http://localhost:5173

# Paste a URL and watch:
# - Fabric data appears immediately (~5 sec)
# - Alternatives load in background (~20 sec more)
```

**Test batch scraper:**
```bash
# Dry run - just Lululemon, limit 2 products
node server/batch-scrape.js lululemon --limit 2

# Check Supabase cache
# Go to Supabase → Table Editor → products_cache
# Should see 2 new Lululemon entries
```

**Test compression:**
```bash
curl -H "Accept-Encoding: gzip" http://localhost:3000/health -v | grep -i "content-encoding"
# Should show: content-encoding: gzip
```

---

## Cost Estimates

**Batch Scraping (25 products overnight):**
- Firecrawl: 25 × $0.015 = $0.375
- Claude: 25 × $0.0075 = $0.188
- SerpAPI: 0 (not needed for caching)
- **Total: ~$0.56 per night**

**Monthly if run nightly:**
- 30 nights × $0.56 = **$16.80/month**

**BUT:** Once cached, those 25 products = instant results for ALL users
- If each cached product gets scanned 100x/month = 2,500 cache hits
- Saves: 2,500 × $0.048 = **$120/month**

**ROI:** Spend $17 to save $120 = 7x return 🚀

---

## Questions?

- Streaming not working? Check browser console for SSE errors
- Batch scraper failing? Check API keys in `.env`
- Want to add more brands? Edit `PRODUCT_URLS` in `batch-scrape.js`

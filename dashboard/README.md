# API OPS Dashboard

Live infrastructure monitor for Fabric Finder API usage tracking.

## Design Philosophy

**Narrative:** Mission Control for a data-driven app - you're a Developer/Operator monitoring infrastructure health in real-time.

**Aesthetic:** Apple-inspired precision meets developer tools. Pure black background with strategic neon accents (10% rule). Physics-based animations, large typographic numbers, generous whitespace.

## Setup

### 1. Database Setup

Run the SQL schema in Supabase:

```bash
# Copy the schema to your clipboard
cat dashboard/schema.sql

# Paste into Supabase SQL Editor and run
```

This creates:
- `api_tracking` table
- `daily_totals` view
- `monthly_totals` view
- Helper functions

### 2. Configure Dashboard

Edit `dashboard/index.html` and replace:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL' // Your project URL
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY' // Anon/public key
```

### 3. Integrate Tracker

In `server/index.js`, add tracking to your API calls:

```javascript
import { trackApiCall, printApiSummary } from './dashboard/tracker.js'

// After Claude API call
const startTime = Date.now()
const fabricData = await extractFabricComposition(content)
const responseTime = Date.now() - startTime

await trackApiCall('claude', {
  scanUrl: url,
  callCount: 1,
  responseTime,
  status: 'success',
  tokensUsed: message.usage?.input_tokens + message.usage?.output_tokens
})

// After SerpAPI call
await trackApiCall('serpapi', {
  scanUrl: url,
  callCount: 5, // Number of searches
  responseTime: Date.now() - startTime,
  status: 'success'
})

// At end of scan
printApiSummary({
  claudeCalls: 2,
  serpapiCalls: 5,
  firecrawlCalls: 1,
  totalCost: 0.048,
  scanTime: 3400
})
```

### 4. Open Dashboard

```bash
# Option 1: Direct file open
open dashboard/index.html

# Option 2: Serve with local server
npx serve dashboard
```

## Features

### Hero Section
- Live clock (updates every second)
- Total scans today (count-up animation)
- Total cost today (with neon green glow)

### API Cards (4 Cards)
- **Claude API** - Neon blue accent (#00F5FF)
- **SerpAPI** - Neon orange accent (#FF6B00) with "TEMPORARY" badge
- **Firecrawl** - Neon purple accent (#BF5FFF)
- **Supabase** - Neon green accent (#39FF14)

Each card shows:
- Pulsing status dot (green = active, red = error, yellow = idle)
- Calls today
- Cost today
- Success rate
- Usage bar (SerpAPI shows 250 free tier limit)
- Last called timestamp

### Cost Breakdown
- Cost per scan
- Monthly projection (based on today's rate)
- Scaling estimates (100 users, 1000 users)

### Scan History Table
- Last 20 scans
- Monospace font for URLs/timestamps
- Status badges (SUCCESS, ERROR, CACHED)
- Alternating row colors for readability

### System Status Bar (Fixed Bottom)
- All 4 APIs with operational status
- SerpAPI remaining searches countdown
- "Amazon Creators API: PENDING" indicator

## Auto-Refresh

- Dashboard auto-refreshes every 30 seconds
- Manual refresh button (top right corner)
- Hover effect: glows green and rotates

## Design Details

Following elite design standards:

- **8-point grid spacing** (4px, 8px, 16px, 24px, 32px, 48px, 64px)
- **Rim lighting** on all cards (subtle 1px top border)
- **Noise texture** overlay (2% opacity to prevent digital banding)
- **Physics-based animations** (springs, not easing curves)
- **Glassmorphism** on status bar (backdrop blur)
- **Pulse animations** for status indicators (2s cubic-bezier)
- **Count-up animations** for hero numbers
- **Staggered fade-ins** for cards (40ms delay per item)
- **Responsive design** (mobile-friendly breakpoints)

## API Cost Models

Current estimates per scan:

- **Claude:** 2 calls × $0.0075 = **$0.015**
- **SerpAPI:** 5 searches × $0.0036 = **$0.018**
- **Firecrawl:** 1 scrape × $0.015 = **$0.015**
- **Supabase:** Free tier = **$0.00**

**Total per scan:** ~$0.048

## Security

- Dashboard uses Supabase ANON key (read-only)
- Tracker uses SERVICE key (write access)
- Row Level Security (RLS) enabled
- No sensitive data exposed in frontend

## Troubleshooting

**Dashboard shows "No data yet":**
- Check Supabase credentials in `index.html`
- Verify `api_tracking` table exists
- Check browser console for errors

**Tracker not logging:**
- Verify `SUPABASE_SERVICE_KEY` in `.env`
- Check server console for tracker errors
- Tracking failures never break main app (non-blocking)

**Numbers not counting up:**
- Refresh the page
- Check that data exists in Supabase

## Future Enhancements

- [ ] Add date range selector (Today / Week / Month)
- [ ] Bar chart for cost breakdown visualization
- [ ] Export data as CSV
- [ ] Real-time WebSocket updates
- [ ] Alert notifications for high usage
- [ ] Integration with Amazon Creators API

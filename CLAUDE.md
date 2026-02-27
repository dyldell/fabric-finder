# Fabric Finder

## What This App Does
Users paste a clothing product URL → the app scrapes the product page → Claude API extracts the fabric composition (e.g. "87% Nylon, 13% Spandex") → the app finds similar quality items at lower prices → monetizes via Amazon affiliate links.

Live at: fabricfinder.fit (currently on Replit — rebuilding locally with new stack)

## Owner
Dylan Dell (dyldell) — beginner developer, learning as he goes. Keep explanations clear and avoid unnecessary complexity.

## Tech Stack
- **Frontend:** React
- **Backend:** Express (Node.js)
- **Database:** Supabase
- **Deployment:** Render
- **Scraping:** Firecrawl MCP
- **AI:** Claude API (claude-sonnet-4-20250514) for fabric extraction
- **Monetization:** Amazon affiliate links (Amazon Associates)
- **Domain:** fabricfinder.fit via Namecheap, DNS on Cloudflare

## MCPs Available
- GitHub
- Supabase
- Playwright
- Firecrawl (primary scraping tool)
- Brave Search
- Context7
- Magic UI

## Project Structure Goal
```
fabricfinder/
├── client/          # React frontend
├── server/          # Express backend
│   └── index.js     # Main server file, /api/analyze route
├── .env             # API keys (never commit this)
├── .gitignore
└── CLAUDE.md
```

## Core Feature: Fabric Extraction
1. User pastes URL (Lululemon, Alo, Patagonia, etc.)
2. Firecrawl scrapes the product page
3. Page content sent to Claude API
4. Claude extracts fabric composition as structured JSON
5. App displays results + suggests cheaper alternatives

### Example Claude API Output
```json
{
  "fabrics": [
    { "type": "Nylon", "percentage": 87 },
    { "type": "Spandex", "percentage": 13 }
  ],
  "quality_tier": "premium athletic",
  "features": ["moisture-wicking", "4-way stretch"]
}
```

## Known Scraping Issues (History)
- Lululemon, Alo, Patagonia use anti-bot protection
- Previously used ScraperAPI → switched to Keiro Labs → both had timeout issues on Replit
- Firecrawl is the new solution — use it as the primary scraping method
- Always set generous timeouts (30000ms minimum) on scraping calls

## Environment Variables Needed
```
ANTHROPIC_API_KEY=
SUPABASE_URL=
SUPABASE_ANON_KEY=
FIRECRAWL_API_KEY=
AMAZON_ASSOCIATE_TAG=
```

## Monetization Plan
- Free tier: limited scans/month with Amazon affiliate links
- Premium tier (future): unlimited scans, fabric quality scoring, price drop alerts
- Ad spend: $100-300/month on Facebook/Instagram + TikTok targeting budget-conscious shoppers aged 40-65

## Target User
Budget-conscious shoppers aged 40-65 who want to find cheaper alternatives to premium athletic/lifestyle clothing brands like Lululemon, Alo Yoga, Patagonia, Vuori.

## UI Design
- Frontend design skill installed: **xenitv1 Maestro** — use it for all UI work
- Goal: premium, distinctive design — NOT generic AI-looking
- Current live site (fabricfinder.fit) is the baseline — improve on it significantly
- Target audience is 40-65 so prioritize: large readable text, clean layouts, simple navigation, high contrast
- Avoid: cluttered interfaces, too many options at once, small buttons/text
- Feel: modern, trustworthy, clean — like a premium shopping tool, not a startup side project

## GitHub
Repo: github.com/dyldell/fabric-finder
Branch: main

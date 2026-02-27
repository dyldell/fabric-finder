# Fabric Finder

Find cheaper alternatives to premium clothing by analyzing fabric composition.

## Live Site
🌐 [fabricfinder.fit](https://fabricfinder.fit)

## Tech Stack
- **Frontend:** React + Vite + Framer Motion
- **Backend:** Express (Node.js)
- **AI:** Claude API (claude-sonnet-4-20250514)
- **Scraping:** Firecrawl MCP
- **Database:** Supabase
- **Deployment:** Render

## Local Development

### Prerequisites
- Node.js 18+
- npm or yarn

### Setup

1. **Clone and install dependencies:**
   ```bash
   npm install
   cd client && npm install
   cd ..
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` and add your API keys:
   - `ANTHROPIC_API_KEY` - Get from [console.anthropic.com](https://console.anthropic.com)
   - `FIRECRAWL_API_KEY` - Get from Firecrawl
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` - Get from Supabase project

3. **Run the development server:**
   ```bash
   npm run dev
   ```

   This starts:
   - Frontend at http://localhost:5173
   - Backend at http://localhost:3000

## How It Works

1. User pastes a product URL (Lululemon, Alo, Patagonia, etc.)
2. Firecrawl scrapes the product page
3. Claude API extracts fabric composition as structured JSON
4. App displays results and suggests cheaper alternatives

## Project Structure

```
fabricfinder/
├── client/              # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── styles/      # CSS files
│   │   └── App.jsx      # Main app component
│   └── package.json
├── server/              # Express backend
│   └── index.js         # Main server file
├── .env                 # Environment variables (not committed)
└── package.json         # Root package.json
```

## Environment Variables

See `.env.example` for required variables.

## Deployment

Deploy to Render:
1. Connect GitHub repo
2. Set environment variables in Render dashboard
3. Deploy with `npm run build && npm start`

## License

MIT - Dylan Dell (@dyldell)
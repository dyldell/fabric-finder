# 🎯 MASTER TODO LIST - Fabric Finder

**Last Updated:** March 3, 2026
**Current Status:** Development complete, ready for deployment prep

---

## 🚨 CRITICAL - Do Before Going Live

### 1. Database Setup (USER TRACKING) ⚠️ **MUST DO FIRST**
- [ ] **Go to Supabase Dashboard** → https://supabase.com/dashboard
- [ ] **SQL Editor** → New Query
- [ ] **Copy/paste** `server/supabase-schema.sql` → Run
- [ ] **Copy/paste** `server/increment-scan-function.sql` → Run
- [ ] **Verify tables created:** Check "Table Editor" tab for `user_scans` and `admin_users`

**Why:** User tracking won't work without these tables. App will error on scan attempts.

---

### 2. Change Admin Secret Key 🔐
- [ ] Open `.env` file
- [ ] Change this line:
  ```bash
  ADMIN_SECRET_KEY=fabricfinder-admin-2026-secret-change-me
  ```
- [ ] To something secure (random characters):
  ```bash
  ADMIN_SECRET_KEY=your-random-secret-abc123xyz789
  ```
- [ ] **DO NOT** commit this to GitHub

**Why:** Current key is in documentation, anyone could get admin access.

---

### 3. Test Everything Locally 🧪

**Admin Access:**
- [ ] Start app: `npm run dev`
- [ ] Visit: `http://localhost:5173/admin?key=YOUR_NEW_SECRET_KEY`
- [ ] Should see "⚡ Admin Mode" badge on results
- [ ] Make 10+ scans → should never be blocked
- [ ] Close browser → reopen → admin status should persist

**Free User (Incognito Window):**
- [ ] Open new incognito window
- [ ] Visit: `http://localhost:5173`
- [ ] Make 3 scans → should work fine
- [ ] Try 4th scan → should be blocked with "3 scans/month limit" error

**Mobile Test:**
- [ ] On your phone (same WiFi): visit `http://YOUR-IP:5173`
  - Find IP: Look at Vite terminal output or run `ifconfig`
- [ ] Test a scan
- [ ] Check text is readable
- [ ] Check buttons are tappable

---

## 💰 MONETIZATION SETUP

### 4. Google AdSense (Can do after launch)
- [ ] **Sign up:** https://adsense.google.com
- [ ] **Submit domain:** fabricfinder.fit for review
- [ ] **Wait 1-3 days** for approval email
- [ ] **After approval:**
  - [ ] Get your Client ID (ca-pub-XXXXXXXXXX)
  - [ ] Get your Ad Slot ID (XXXXXXXXXX)
  - [ ] Open `client/src/components/AdSlot.jsx`
  - [ ] Replace placeholder IDs (lines 22-23)
  - [ ] Open `client/index.html`
  - [ ] Add AdSense script to `<head>` section

**Current Status:** Ad slot component ready, just need your credentials

---

### 5. Add Admin Users to Whitelist (Optional)
- [ ] Visit your site to get your user ID:
  - Open browser console
  - Type: `localStorage.getItem('fabricfinder_uid')`
  - Copy the value
- [ ] In Supabase SQL Editor, run:
  ```sql
  INSERT INTO admin_users (user_id, email, notes)
  VALUES
    ('your-user-id-here', 'your-email@example.com', 'Main admin');
  ```

**Why:** Admin users bypass the 3 scans/month limit

---

## 🚀 DEPLOYMENT TO RENDER

### 6. Commit Current State
- [ ] `git status` → verify nothing sensitive
- [ ] `git add .`
- [ ] `git commit -m "Final prep for production"`
- [ ] `git push origin main`

---

### 7. Deploy to Render
- [ ] Go to: https://dashboard.render.com
- [ ] Click **"New +"** → **"Web Service"**
- [ ] Connect repository: `dyldell/fabric-finder`
- [ ] Branch: `main`

**Build Settings:**
- **Name:** fabric-finder
- **Build Command:** `npm install && cd client && npm install && npm run build && cd ..`
- **Start Command:** `npm start`
- **Instance Type:** Free (can upgrade later)

**Environment Variables** (click "Advanced"):
```bash
NODE_ENV=production
PORT=3000
ANTHROPIC_API_KEY=sk-ant-api03-...
FIRECRAWL_API_KEY=fc-...
BRAVE_API_KEY=BSAU...
SERP_API_KEY=57839...
SUPABASE_URL=https://lqunkwbotsthefuxnvnf.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGci... (use SERVICE_KEY not ANON_KEY!)
AMAZON_ASSOCIATE_TAG=fabricfinde0f-20
ADMIN_SECRET_KEY=your-random-secret-abc123xyz789 (your new one!)
```

- [ ] Click **"Create Web Service"**
- [ ] Wait 5-10 minutes for build
- [ ] Test your Render URL: `https://fabric-finder.onrender.com`

---

### 8. Connect Domain (fabricfinder.fit)

**In Render:**
- [ ] Go to service → **"Settings"** → **"Custom Domain"**
- [ ] Click **"Add Custom Domain"**
- [ ] Enter: `fabricfinder.fit`
- [ ] **Note the DNS instructions** (A record or CNAME)
- [ ] Repeat for `www.fabricfinder.fit`

**In Cloudflare:**
- [ ] Go to: https://dash.cloudflare.com
- [ ] Select: `fabricfinder.fit`
- [ ] Click **"DNS"**
- [ ] Add A records:
  - Type: A, Name: @, Content: (IP from Render), Proxied: ON
  - Type: A, Name: www, Content: (IP from Render), Proxied: ON
- [ ] Go to **SSL/TLS** → Set to **"Full (strict)"**
- [ ] Enable **"Always Use HTTPS"**

**Wait 5-60 minutes** for DNS propagation

- [ ] Visit: https://fabricfinder.fit
- [ ] Should work! 🎉

---

### 9. Update Production URLs
- [ ] Open `client/public/manifest.json`
- [ ] Change:
  ```json
  {
    "start_url": "https://fabricfinder.fit/",
    "scope": "https://fabricfinder.fit/"
  }
  ```
- [ ] Commit: `git add . && git commit -m "Update manifest for production" && git push`
- [ ] Render will auto-deploy

---

## 📱 PWA SETUP (OPTIONAL BUT RECOMMENDED)

### 10. Generate App Icons
**Option A: Online Tool (Easiest)**
- [ ] Go to: https://realfavicongenerator.net
- [ ] Upload a square image (512x512px)
- [ ] Download the package
- [ ] Extract to `client/public/icons/`

**Option B: Script (If you have ImageMagick)**
- [ ] `brew install imagemagick`
- [ ] `./generate-icons.sh`

**Current Status:** PWA works without icons, they just show as broken images

---

## ✅ POST-LAUNCH VERIFICATION

### 11. Test Production Site
- [ ] Visit: https://fabricfinder.fit
- [ ] Scan a product → should work
- [ ] Check footer → affiliate disclosure visible
- [ ] Test admin URL: `https://fabricfinder.fit/admin?key=YOUR_KEY`
- [ ] Test free user in incognito → 3 scan limit works
- [ ] Test on phone → layout looks good

### 12. Share Admin Access
Send this to friends/girlfriend:
```
Hey! Check out Fabric Finder - finds cheaper alternatives to expensive clothes:

Admin Access (unlimited scans, no ads):
https://fabricfinder.fit/admin?key=YOUR_SECRET_KEY

Just click once and you're set for 90 days!
```

---

## 📊 MONITORING (AFTER LAUNCH)

### 13. Daily Checks
- [ ] **Render Logs:** Check for errors
- [ ] **Supabase:** Check user_scans table growing
- [ ] **AdSense:** Check daily earnings (after approval)
- [ ] **Amazon Associates:** Check affiliate clicks/sales

---

## 📚 REFERENCE - What's Already Built

### ✅ Features Complete
- [x] Fabric extraction (Claude API)
- [x] Product scraping (Firecrawl)
- [x] Alternative search (SerpAPI)
- [x] Amazon affiliate links
- [x] Caching system (Supabase)
- [x] Streaming API (fast perceived performance)
- [x] Anonymous user tracking
- [x] 3 scans/month limit
- [x] Admin unlimited access
- [x] Browser fingerprinting
- [x] Rate limiting (20/hour)
- [x] Security headers
- [x] HTTPS enforcement
- [x] Error sanitization
- [x] $50/day cost kill switch
- [x] Mobile optimization
- [x] PWA support
- [x] AdSense integration (needs credentials)
- [x] FTC compliance footer
- [x] Privacy policy page

---

## 🎯 QUICK START CHECKLIST (MINIMUM TO GO LIVE)

**Absolute minimum to deploy:**
1. ✅ Run SQL scripts in Supabase (user tracking)
2. ✅ Change admin secret key
3. ✅ Test locally (admin + free user)
4. ✅ Deploy to Render with env vars
5. ✅ Connect domain in Cloudflare
6. ✅ Test production site

**Everything else can be done after going live.**

---

## 📞 HELP

**Documentation Files:**
- `USER-TRACKING-SETUP.md` - Database setup
- `DEPLOYMENT-GUIDE.md` - Full Render deployment
- `MONETIZATION-SETUP.md` - AdSense setup
- `SECURITY-IMPLEMENTATION.md` - Security features
- `MOBILE-PWA-SUMMARY.md` - PWA features
- `PWA-MOBILE-SETUP.md` - Complete PWA guide
- `ADMIN-QUICK-REFERENCE.md` - Admin commands

**Your API Keys:**
- Check `.env` file (NEVER commit this!)
- Set in Render environment variables for production

---

## 🎉 YOU'RE READY!

Once you complete the Critical section (items 1-3), you're ready to deploy.
Everything else can be done before or after launch.

**Good luck! 🚀**

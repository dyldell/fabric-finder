# 🚀 Deployment Guide - fabricfinder.fit

**Goal:** Deploy Fabric Finder to Render and connect to fabricfinder.fit domain

---

## 📋 Pre-Deployment Checklist

### 1. Security & Secrets

- [ ] **Change ADMIN_SECRET_KEY in `.env`**
  ```bash
  # Current (CHANGE THIS!)
  ADMIN_SECRET_KEY=fabricfinder-admin-2026-secret-change-me

  # Change to something secure:
  ADMIN_SECRET_KEY=your-random-secret-abc123xyz789
  ```

- [ ] **Don't commit `.env` file**
  ```bash
  # Verify .env is in .gitignore
  cat .gitignore | grep .env
  # Should show: .env
  ```

### 2. App Icons (Optional but Recommended)

- [ ] Generate icons using RealFaviconGenerator.net
- [ ] Or run: `./generate-icons.sh` (after `brew install imagemagick`)
- [ ] Or skip for now (can add later)

### 3. Test Locally

- [ ] Admin access works: `http://localhost:5173/admin?key=YOUR_KEY`
- [ ] Free user scan limits work (test in incognito)
- [ ] Footer shows affiliate disclosure
- [ ] Mobile layout looks good

### 4. Commit Your Code

```bash
# Check status
git status

# Add all changes
git add .

# Commit
git commit -m "Add monetization and PWA features

- Admin access via secret URL
- Free tier scan limits (5/month)
- Google AdSense integration (ready)
- FTC compliance (affiliate disclosure)
- PWA features (installable, offline support)
- Mobile optimization for 40-65 age group

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"

# Push to GitHub
git push origin main
```

---

## 🎯 Step 1: Deploy to Render

### A. Create New Web Service

1. **Go to Render:** https://dashboard.render.com

2. **Click "New +" → "Web Service"**

3. **Connect GitHub:**
   - Select repository: `dyldell/fabric-finder`
   - Branch: `main`

### B. Configure Build Settings

**Name:** `fabric-finder`

**Region:** Choose closest to your users (e.g., Oregon for US West)

**Branch:** `main`

**Build Command:**
```bash
npm install && cd client && npm install && npm run build && cd ..
```

**Start Command:**
```bash
npm start
```

**Environment:** `Node`

**Instance Type:** `Free` (for now, can upgrade later)

### C. Add Environment Variables

Click **"Advanced"** → **"Add Environment Variable"**

Add these one by one:

```bash
# Required
NODE_ENV=production
PORT=3000

# API Keys
ANTHROPIC_API_KEY=your_anthropic_api_key_here
FIRECRAWL_API_KEY=your_firecrawl_api_key_here
BRAVE_API_KEY=your_brave_api_key_here
SERP_API_KEY=your_serpapi_key_here

# Supabase
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_KEY=your_supabase_service_key

# Amazon Affiliate
AMAZON_ASSOCIATE_TAG=your_amazon_associate_tag

# Admin Access (CHANGE THIS!)
ADMIN_SECRET_KEY=your-random-secret-abc123xyz789
```

⚠️ **IMPORTANT:** Change `ADMIN_SECRET_KEY` to something secure!

### D. Deploy

1. Click **"Create Web Service"**

2. Render will start building:
   - Installing dependencies
   - Building React app
   - Starting server

3. Wait 5-10 minutes for first deploy

4. You'll get a URL like: `https://fabric-finder.onrender.com`

5. **Test it:** Visit the URL and make sure it works!

---

## 🌐 Step 2: Connect Your Domain

### Current Setup
- **Domain:** fabricfinder.fit (Namecheap)
- **DNS:** Cloudflare
- **Target:** Render

### A. Get Render's IP/CNAME

1. In Render dashboard, go to your service

2. Click **"Settings"** → **"Custom Domain"**

3. Click **"Add Custom Domain"**

4. Enter: `fabricfinder.fit`

5. Render will show you DNS instructions:
   ```
   Type: A Record
   Name: @
   Value: 216.24.57.1 (example - use actual IP Render gives you)

   OR

   Type: CNAME
   Name: @
   Value: fabric-finder.onrender.com
   ```

### B. Add www Subdomain

Repeat for `www.fabricfinder.fit`:

1. Click **"Add Custom Domain"** again

2. Enter: `www.fabricfinder.fit`

3. Note the DNS instructions

---

## ☁️ Step 3: Configure Cloudflare DNS

### A. Login to Cloudflare

1. Go to: https://dash.cloudflare.com

2. Select your domain: `fabricfinder.fit`

3. Click **"DNS"** in left sidebar

### B. Add DNS Records

**Option 1: A Record (Recommended)**

Add these records:

| Type | Name | Content | Proxy Status | TTL |
|------|------|---------|--------------|-----|
| A | @ | 216.24.57.1 | Proxied (orange cloud) | Auto |
| A | www | 216.24.57.1 | Proxied (orange cloud) | Auto |

**Option 2: CNAME (Alternative)**

| Type | Name | Content | Proxy Status | TTL |
|------|------|---------|--------------|-----|
| CNAME | @ | fabric-finder.onrender.com | Proxied | Auto |
| CNAME | www | fabric-finder.onrender.com | Proxied | Auto |

⚠️ **Note:** Use the actual IP/CNAME Render gives you!

### C. SSL/TLS Settings

1. In Cloudflare, go to **SSL/TLS**

2. Set encryption mode to: **Full (strict)**

3. Enable these:
   - ✅ Always Use HTTPS
   - ✅ Automatic HTTPS Rewrites
   - ✅ HTTP Strict Transport Security (HSTS)

### D. Wait for Propagation

- DNS changes take 5-60 minutes
- Check status: `dig fabricfinder.fit` or https://dnschecker.org

---

## 🔒 Step 4: SSL Certificate (Render)

1. Back in Render dashboard

2. Go to **Settings** → **Custom Domain**

3. Render will automatically provision SSL certificate

4. Wait 5-10 minutes

5. Status should show: ✅ **Certificate Ready**

6. Your site is now live at: `https://fabricfinder.fit` 🎉

---

## ✅ Step 5: Verify Everything Works

### Test Production Site

**1. Basic Functionality:**
- [ ] Visit: https://fabricfinder.fit
- [ ] Site loads correctly
- [ ] Try scanning a product URL
- [ ] Results appear

**2. Admin Access:**
```
https://fabricfinder.fit/admin?key=your-random-secret-abc123xyz789
```
- [ ] Admin badge appears
- [ ] Unlimited scans work
- [ ] No ads shown

**3. Free User:**
- [ ] Open incognito
- [ ] Visit: https://fabricfinder.fit
- [ ] Make 5 scans
- [ ] 6th scan should be blocked

**4. Mobile:**
- [ ] Test on your phone
- [ ] Layout looks good
- [ ] Text is readable
- [ ] Buttons are tappable
- [ ] Can install as PWA (browser menu)

**5. PWA:**
- [ ] Chrome: Check for install button
- [ ] Mobile: Can add to home screen
- [ ] Offline page works (turn off WiFi)

**6. Footer:**
- [ ] FTC affiliate disclosure shows
- [ ] Privacy Policy link works (if created)

---

## 🔧 Step 6: Update Code for Production

### A. Update CORS Origins

**File:** `server/security-config.js`

Already includes production URL - verify:

```javascript
export const ALLOWED_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
  'https://fabricfinder.fit',        // ✅ Already there
  'https://www.fabricfinder.fit'     // ✅ Already there
]
```

### B. Update Manifest (PWA)

**File:** `client/public/manifest.json`

```json
{
  "start_url": "https://fabricfinder.fit/",
  "scope": "https://fabricfinder.fit/"
}
```

Commit and push:
```bash
git add .
git commit -m "Update manifest for production domain"
git push origin main
```

Render will auto-deploy the changes.

---

## 📊 Step 7: Monitor & Analytics

### A. Check Render Logs

1. Render dashboard → Your service

2. Click **"Logs"** tab

3. Monitor for errors:
   - Server startup
   - API calls
   - Rate limiting

### B. Supabase Dashboard

1. Visit: https://supabase.com/dashboard

2. Go to your project

3. Check:
   - Cached products growing
   - No errors in logs

### C. Cost Tracking

**File:** `dashboard/tracker.js` logs API costs

View in Render logs or add endpoint:

```javascript
// In server/index.js, add:
app.get('/api/admin/costs', async (req, res) => {
  if (req.cookies.admin_session !== 'true') {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const todaysCost = await getTodaysCost()
  res.json({ cost: todaysCost })
})
```

---

## 🎯 Step 8: Share Admin URLs

### Create Admin Links

**For you:**
```
https://fabricfinder.fit/admin?key=your-random-secret-abc123xyz789
```

**For friends/girlfriend:**

Send them:
> Hey! I built Fabric Finder - check it out:
>
> **Admin access (unlimited scans, no ads):**
> https://fabricfinder.fit/admin?key=your-random-secret-abc123xyz789
>
> Just click once and it'll remember you!

---

## 🐛 Troubleshooting

### "Site not loading"

**Check DNS:**
```bash
dig fabricfinder.fit
# Should show Render's IP
```

**Check Cloudflare:**
- DNS records correct?
- Proxy enabled (orange cloud)?
- SSL mode: Full (strict)?

**Check Render:**
- Service running?
- Logs show errors?

### "Admin access not working"

**Check:**
- Cookie enabled in browser?
- ADMIN_SECRET_KEY set in Render env vars?
- Using HTTPS (not HTTP)?
- Admin URL key matches env var?

### "CORS errors"

**Check:**
- `ALLOWED_ORIGINS` includes your domain
- Cloudflare proxy enabled (handles CORS)
- Browser console for exact error

### "Build failed on Render"

**Common issues:**
- Missing dependencies
- Build command incorrect
- Node version mismatch

**Fix:**
```bash
# Test build locally first
npm install
cd client && npm install && npm run build
cd ..
npm start
```

### "Site is slow"

**First deploy is slow** - Render free tier cold starts

**Solutions:**
- Upgrade to paid tier ($7/mo - instant startup)
- Use caching (already implemented)
- Optimize images

---

## 💰 Costs (Production)

### Current (Free Tier)
- **Render:** $0/month (free tier, cold starts)
- **Supabase:** $0/month (free tier, 500MB DB)
- **Cloudflare:** $0/month (free tier)
- **Domain:** ~$10/year (Namecheap)

**Total:** ~$1/month

### Recommended (Paid)
- **Render:** $7/month (no cold starts)
- **Supabase:** $0/month (free tier sufficient)
- **Cloudflare:** $0/month

**Total:** ~$7/month + $10/year domain

---

## 🎊 Post-Deployment Checklist

- [ ] Site live at fabricfinder.fit
- [ ] HTTPS working (green lock)
- [ ] Admin access tested
- [ ] Free tier limits working
- [ ] Mobile tested
- [ ] PWA installable
- [ ] Footer disclosure visible
- [ ] Shared admin URL with friends/gf
- [ ] Google AdSense applied for
- [ ] Monitoring logs for errors

---

## 📚 Next Steps After Deploy

1. **Apply for Google AdSense** (if not already)
   - Visit: https://adsense.google.com
   - Submit fabricfinder.fit
   - Wait 1-3 days

2. **Add AdSense Credentials** (when approved)
   - Update `client/src/components/AdSlot.jsx`
   - Add script to `client/index.html`

3. **Create App Icons** (if not done)
   - Use: https://realfavicongenerator.net
   - Upload to `client/public/icons/`

4. **Marketing**
   - Share on social media
   - Target 40-65 demographic
   - Facebook/Instagram ads

5. **Monitor Performance**
   - Check Render logs daily
   - Monitor API costs
   - Track user engagement

---

## 🚀 You're Live!

Once deployed, your app is:
- ✅ Live at fabricfinder.fit
- ✅ HTTPS secured
- ✅ PWA installable
- ✅ Mobile optimized
- ✅ Admin access ready
- ✅ Monetization active
- ✅ Ready for users!

**Share it with the world! 🎉**

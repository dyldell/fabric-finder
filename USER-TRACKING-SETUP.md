# User Tracking Setup Guide

## Overview
Anonymous user tracking system to prevent scan limit bypass (3 scans/month for free users).

**How it works:**
- Generates unique user ID on first visit
- Stores in cookie + localStorage (harder to bypass)
- Browser fingerprinting as backup
- Server tracks scans in Supabase database
- Admin users get unlimited scans

## Database Setup

### 1. Run SQL Scripts in Supabase

Go to Supabase Dashboard → SQL Editor → New Query

**Step 1: Create tables**
```bash
# Copy and paste the contents of server/supabase-schema.sql
```

**Step 2: Create atomic increment function**
```bash
# Copy and paste the contents of server/increment-scan-function.sql
```

### 2. Add Admin Users (Optional)

To whitelist admin emails for unlimited scans:

```sql
-- Add your admin user ID(s)
INSERT INTO admin_users (user_id, email, notes)
VALUES
  ('your-user-id-here', 'your-email@example.com', 'Main admin'),
  ('another-user-id', 'another@example.com', 'Secondary admin');
```

**Note:** You'll need to get your user_id by:
1. Visit the site
2. Open browser console
3. Type: `localStorage.getItem('fabricfinder_uid')`
4. Copy that value and insert it above

## How Tracking Works

### Frontend
1. `getUserIdentifiers()` - Gets userId (from cookie/localStorage) + fingerprint
2. Sends both with every `/api/analyze` request
3. Server checks limit and blocks if exceeded

### Backend
1. `checkScanLimit` middleware - Checks if user can scan
2. Queries `user_scans` table for current month count
3. If ≥3 scans → blocks with 429 error
4. If <3 scans → allows and increments count after success

### Bypass Protection
- **Clearing cookies:** Fingerprint catches them
- **Clearing localStorage:** Cookie + fingerprint catches them
- **Private browsing:** Each window gets new ID (acceptable)
- **VPN/IP change:** Doesn't matter, we track by device

## Testing

### Check your scan count
```sql
SELECT * FROM user_scans
WHERE user_id = 'your-user-id-here'
ORDER BY created_at DESC;
```

### Reset your scans (testing only)
```sql
DELETE FROM user_scans WHERE user_id = 'your-user-id-here';
```

### View all users
```sql
SELECT user_id, scan_month, scan_count, last_scan_at
FROM user_scans
ORDER BY last_scan_at DESC
LIMIT 50;
```

## Environment Variables

Make sure these are set in `.env`:

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_KEY=your_service_key  # Important: Use SERVICE_KEY not ANON_KEY
```

## What Changed

**Removed:**
- ❌ localStorage-only tracking (too easy to bypass)
- ❌ Client-side scan limit checking

**Added:**
- ✅ Server-side scan tracking in database
- ✅ User ID + fingerprint combo
- ✅ Admin whitelist
- ✅ Atomic increment function (thread-safe)

**Files:**
- `client/src/utils/userTracking.js` - User ID + fingerprint generation
- `server/index.js` - Scan limit middleware
- `server/supabase-schema.sql` - Database tables
- `server/increment-scan-function.sql` - Atomic increment function

## Troubleshooting

**"User identification required" error**
- User has cookies disabled
- Tell them to enable cookies or the site won't work

**Scans not incrementing**
- Check Supabase service key is set (not anon key)
- Check SQL functions were created successfully
- Check server logs for errors

**Everyone getting unlimited scans**
- Make sure you ran both SQL scripts
- Check middleware is applied to endpoints (should see `checkScanLimit` in route)

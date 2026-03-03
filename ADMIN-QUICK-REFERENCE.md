# Admin Quick Reference Card

## 🔑 Admin URLs

### Local Development
```
http://localhost:5173/admin?key=fabricfinder-admin-2026-secret-change-me
```

### Production (After Deploy)
```
https://fabricfinder.fit/admin?key=fabricfinder-admin-2026-secret-change-me
```

**⚠️ CHANGE THIS KEY BEFORE DEPLOYING!**

---

## 👥 Share With

**Copy-paste to friends/girlfriend:**

> Hey! I built Fabric Finder - it analyzes clothing fabric and finds cheaper alternatives.
>
> You have admin access (unlimited scans, no ads):
> http://localhost:5173/admin?key=fabricfinder-admin-2026-secret-change-me
>
> Just click the link once and it'll remember you for 90 days!

---

## ✅ Admin Features

When logged in as admin:
- ⚡ Purple "Admin Mode" badge on results
- ♾️ Unlimited scans (no 5/month limit)
- 🚫 No ads shown
- ⏰ 90-day persistent session

---

## 🧪 Quick Test

1. Click admin URL above
2. Paste any Lululemon/Alo/Vuori product link
3. Scan it → Should see "⚡ Admin Mode" badge
4. Make 10+ scans → Should never hit rate limit
5. Close browser → Reopen → Admin status persists

---

## 🔧 Admin Management

### Check Who's Admin
Look for `admin_session=true` cookie in browser DevTools

### Remove Admin Access
Delete the `admin_session` cookie or:
```javascript
// In browser console:
document.cookie = "admin_session=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;"
```

### Reset Scan Counter (Testing)
```javascript
// In browser console:
localStorage.removeItem('fabricfinder_scans')
localStorage.removeItem('fabricfinder_month')
```

---

## 🚀 Before Production Deploy

1. Open `.env`
2. Change this line:
   ```
   ADMIN_SECRET_KEY=fabricfinder-admin-2026-secret-change-me
   ```
   To something more secure:
   ```
   ADMIN_SECRET_KEY=your-random-secret-xyz123
   ```
3. Update admin URLs above with new key
4. Add to Render environment variables

---

## 📞 Troubleshooting

**Admin access not working?**
- Cookies enabled?
- Key matches `.env`?
- Server restarted?

**Still seeing ads as admin?**
- Check for "⚡ Admin Mode" badge
- If missing, revisit admin URL

**Rate limited as admin?**
- Clear cookies and revisit admin URL
- Check server logs for "[ADMIN] Admin access granted"

---

**That's it! Keep this file handy for quick reference. 🎉**

# AKPsi Rush Check-in System

## Setup (one time)

### 1. Install dependencies
```
npm install
```

### 2. Run locally
```
npm run dev
```
Open http://localhost:5173 in your browser.

---

## Using it during rush

**6 sign-in computers:** All open `http://YOUR-DEPLOYED-URL/kiosk`  
Every check-in appears on all devices instantly via Supabase real-time.

**Your phone (queue view):** Open `http://YOUR-DEPLOYED-URL/queue`  
See everyone waiting, ordered by check-in time. Tap a name to go straight to their camera session.

**Camera station:** Opens automatically when you tap a name in the queue.  
Takes photo → uploads to Supabase storage → marks them done → loads next person automatically.

---

## Deploy to Vercel (free, 5 minutes)

1. Push this folder to a GitHub repo
2. Go to vercel.com → Import project → select your repo
3. Deploy — Vercel auto-detects Vite
4. Share the URL with your chapter

---

## Loading real rushee data

Replace the seeded rows in Supabase with your real rush profile CSV:
- Go to Supabase → Table Editor → rushees → Import CSV
- Columns needed: `id` (PSU ID), `name`, `major`, `year`, `email`

---

## File structure
```
src/
  lib/
    supabase.js   — database connection
    utils.js      — fuzzy match, helpers
  pages/
    Kiosk.jsx     — sign-in station (one per computer)
    Queue.jsx     — photo queue (phone)
    Camera.jsx    — camera station
  App.jsx         — routing
  main.jsx        — entry point
  index.css       — global styles
```

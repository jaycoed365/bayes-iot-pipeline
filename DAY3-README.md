# Day 3 — Setup Guide

This zip adds the Next.js dashboard to `apps/web/`.

## What gets added

```
apps/web/
├── package.json              ← UPDATED (adds recharts, date-fns, tailwind)
├── next.config.js            ← NEW
├── tailwind.config.js        ← NEW
├── postcss.config.js         ← NEW
├── tsconfig.json             ← NEW
├── src/
│   ├── lib/prisma.ts         ← NEW (Prisma singleton)
│   └── app/
│       ├── layout.tsx        ← NEW (root layout, dark theme)
│       ├── page.tsx          ← NEW (landing page)
│       ├── dashboard.tsx     ← NEW (live charts component)
│       ├── globals.css       ← NEW (Tailwind base)
│       └── api/readings/route.ts  ← NEW (JSON API)
```

## Setup steps

### 1. Extract the zip into your project

```bash
cd /tmp
unzip -o /c/Users/jayco/Downloads/day3-files.zip   # adjust path if downloaded elsewhere
cp -r /tmp/day3-files/. /c/Users/jayco/bayes-iot-pipeline/
cd /c/Users/jayco/bayes-iot-pipeline
```

Verify with `ls apps/web/src/app/` (should show `page.tsx`, `dashboard.tsx`, etc.).

### 2. Install new dependencies

```bash
pnpm install
```

This adds Recharts, Tailwind, date-fns. Takes ~30 seconds.

### 3. Generate Prisma client

(Should already be done from Day 2, but doesn't hurt to verify)

```bash
cd apps/web
pnpm prisma generate
```

### 4. Start the dashboard locally

Still in `apps/web`:

```bash
pnpm dev
```

You should see:
```
▲ Next.js 14.2.x
- Local:        http://localhost:3000
✓ Ready in 1.5s
```

### 5. Open the dashboard in your browser

Open http://localhost:3000

You'll see:
- "No readings yet" if simulator isn't running, OR
- Live charts if you have data from Day 2

### 6. Test live updates with simulator

In a SECOND Git Bash window:

```bash
cd /c/Users/jayco/bayes-iot-pipeline
pnpm dev:ingest
```

In a THIRD Git Bash window:

```bash
cd /c/Users/jayco/bayes-iot-pipeline
pnpm simulate
```

Watch your dashboard at http://localhost:3000 — every 10 seconds it auto-refreshes and pulls fresh data.

You should see:
- ✅ 4 charts (Temperature, Humidity, Pressure, VOC)
- ✅ Current values at top of each chart
- ✅ Min/max range
- ✅ "last reading" indicator that turns green when fresh
- ✅ Smooth line charts that update every 10s

### 7. Commit and push

When everything works:

```bash
git add .
git commit -m "feat: live dashboard with 4-chart grid and auto-refresh"
git push
```

---

## End-of-Day-3 milestone

After this:
- ✅ Dashboard works locally at http://localhost:3000
- ✅ Live data flowing from Neon
- ✅ Code on GitHub
- ✅ Ready for Vercel auto-deploy

Next phase tomorrow: Connect Vercel to GitHub, deploy ingest to Fly, point jaycode365.com domain.

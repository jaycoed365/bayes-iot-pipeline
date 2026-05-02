# Day 2 — Setup Guide

This zip adds three things to your `bayes-iot-pipeline` repo:

1. **Prisma schema** with `EnvReading`, `Forecast`, `Anomaly` tables
2. **Ingest service** (Express webhook receiver)
3. **Simulator script** (realistic environmental data generator)

---

## What gets installed where

```
bayes-iot-pipeline/
├── apps/
│   ├── web/
│   │   ├── package.json            ← NEW (Next.js + Prisma)
│   │   └── prisma/schema.prisma    ← NEW (database schema)
│   └── ingest/
│       ├── package.json            ← NEW (Express + Prisma)
│       ├── tsconfig.json           ← NEW
│       └── src/index.ts            ← NEW (webhook receiver)
└── scripts/
    └── simulator.ts                ← NEW (data generator)
```

---

## Setup steps

### 1. Extract the zip into your project

```bash
cd /tmp
unzip -o /c/Users/jayco/Downloads/day2-files.zip
cp -r /tmp/day2-files/. /c/Users/jayco/bayes-iot-pipeline/
cd /c/Users/jayco/bayes-iot-pipeline
```

Verify with `ls apps/ingest/src/` (should show `index.ts`).

### 2. Add DATABASE_URL to .env

Create a `.env` file in the project root (NOT `.env.example`):

```bash
echo "DATABASE_URL=YOUR_NEON_URL_HERE" > .env
echo "NOTEHUB_SECRET=$(openssl rand -hex 32)" >> .env
```

Replace `YOUR_NEON_URL_HERE` with your full Neon connection string.

If `openssl` doesn't exist on your machine, just use any long random string for NOTEHUB_SECRET.

### 3. Install new dependencies

```bash
pnpm install
```

This picks up the new package.json files for ingest and web, and installs Prisma, Express, etc.

### 4. Generate Prisma client and run migration

```bash
cd apps/web
pnpm prisma migrate dev --name init
```

This:
- Connects to your Neon Postgres
- Creates the `EnvReading`, `Forecast`, `Anomaly` tables
- Generates the TypeScript Prisma client

You should see "Your database is now in sync with your schema."

### 5. Start the ingest service

```bash
cd ../../        # back to project root
pnpm dev:ingest
```

You should see:
```
ingest service listening on :3001
  health: http://localhost:3001/health
  webhook: http://localhost:3001/api/notehub/ingest
```

Leave this running.

### 6. In a SECOND Git Bash window, start the simulator

```bash
cd /c/Users/jayco/bayes-iot-pipeline
pnpm simulate
```

You should see lines like:
```
simulator: posting to http://localhost:3001/api/notehub/ingest
✓ temp= 20.3°C  hum= 59.4%  voc=78421Ω  id=abc123de
✓ temp= 20.4°C  hum= 59.1%  voc=80123Ω  id=def456gh
```

Meanwhile in the ingest window:
```
✓ dev:simulator-001 @ 2026-05-01T... temp=20.3°C hum=59.4%
✓ dev:simulator-001 @ 2026-05-01T... temp=20.4°C hum=59.1%
```

### 7. Verify in Neon's SQL Editor

Open https://console.neon.tech → ThermalKafka project → SQL Editor.

Run:
```sql
SELECT * FROM "EnvReading" ORDER BY "capturedAt" DESC LIMIT 10;
```

You should see your simulator's readings flowing in.

---

## End-of-Day-2 milestone

✅ `EnvReading` table exists on Neon
✅ Ingest service running locally
✅ Simulator producing realistic data
✅ Rows landing in Postgres
✅ Code pushed to GitHub

Next: Day 3 — deploy the ingest service to Fly.io and the dashboard to Vercel.

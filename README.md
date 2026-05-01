# bayes-iot-pipeline

End-to-end IoT pipeline with Bayesian time-series forecasting.

## Stack
- Web: Next.js on Vercel
- Database: Neon (serverless Postgres) + Prisma
- Services: webhook ingest + simulator (Node + TypeScript)
- ML (Phase 2): PyMC for Bayesian forecasting + classical baselines
- Edge device: Blues Notecard Cell+WiFi + STM32 Swan + BME680

## Layout
- apps/web - Next.js dashboard
- apps/ingest - webhook receiver
- apps/consumer - Phase 2 ML scheduler
- packages/shared - TypeScript types
- scripts/ - simulator, smoke tests

// Ingest service: receives webhook POSTs from Notehub (or our simulator),
// validates the shared secret, and writes to Postgres via Prisma.

import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import type { NotehubEvent } from "@jaycode/shared";

const app = express();
app.use(express.json({ limit: "1mb" }));

const prisma = new PrismaClient();
const PORT = Number(process.env.PORT ?? 3001);
const SECRET = process.env.NOTEHUB_SECRET;

if (!SECRET) {
  console.error("FATAL: NOTEHUB_SECRET not set in environment");
  process.exit(1);
}

// Health check
app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ingest", time: new Date().toISOString() });
});

// Webhook endpoint
app.post("/api/notehub/ingest", async (req, res) => {
  // Validate shared secret
  const provided = req.header("X-Notehub-Secret");
  if (provided !== SECRET) {
    console.warn("rejected: bad secret");
    return res.status(401).json({ error: "unauthorized" });
  }

  const event = req.body as NotehubEvent;

  // Basic validation
  if (!event?.device || typeof event.when !== "number" || !event.body) {
    return res.status(400).json({ error: "malformed payload" });
  }

  if (event.file !== "env.qo") {
    // We only accept env readings; ignore other notefiles
    return res.status(200).json({ ignored: true, reason: "wrong notefile" });
  }

  const { temp_c, humidity, pressure_hpa, voc_ohms } = event.body;
  if (typeof temp_c !== "number" || typeof humidity !== "number") {
    return res.status(400).json({ error: "missing temp_c or humidity" });
  }

  try {
    // Idempotent upsert: same device + same captured_at = same row
    const reading = await prisma.envReading.upsert({
      where: {
        deviceUid_capturedAt: {
          deviceUid: event.device,
          capturedAt: new Date(event.when * 1000),
        },
      },
      create: {
        deviceUid: event.device,
        capturedAt: new Date(event.when * 1000),
        ingestedAt: new Date(),
        tempC: temp_c,
        humidity,
        pressureHpa: pressure_hpa ?? null,
        vocOhms: voc_ohms ?? null,
      },
      update: {
        // If we receive it again, just refresh timestamps
        ingestedAt: new Date(),
      },
    });

    console.log(`✓ ${event.device} @ ${reading.capturedAt.toISOString()} temp=${temp_c}°C hum=${humidity}%`);
    return res.json({ ok: true, id: reading.id });
  } catch (err) {
    console.error("write error:", err);
    return res.status(500).json({ error: "write failed" });
  }
});

app.listen(PORT, () => {
  console.log(`ingest service listening on :${PORT}`);
  console.log(`  health: http://localhost:${PORT}/health`);
  console.log(`  webhook: http://localhost:${PORT}/api/notehub/ingest`);
});

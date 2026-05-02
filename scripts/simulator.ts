// Simulator: produces realistic environmental sensor data and posts it to the
// ingest service every N seconds. Models:
//  - Temperature: diurnal sine cycle (cool at night, warm at midday) + slow drift + noise
//  - Humidity: inverse correlation with temp + noise
//  - Pressure: slow random walk
//  - VOC gas resistance: occasional "events" (cooking, cleaning) drop the value
//
// This isn't just for show — when we plug in PyMC in Phase 2, it will have
// genuinely interesting structure to learn (cycles, autocorrelation, anomalies).

import "dotenv/config";

const INGEST_URL = process.env.INGEST_URL ?? "http://localhost:3001/api/notehub/ingest";
const SECRET = process.env.NOTEHUB_SECRET;
const DEVICE_UID = process.env.SIM_DEVICE_UID ?? "dev:simulator-001";
const INTERVAL_MS = Number(process.env.SIM_INTERVAL_MS ?? 5000);

if (!SECRET) {
  console.error("FATAL: NOTEHUB_SECRET not set");
  process.exit(1);
}

// Simulator state
let pressureHpa = 1013.25;
let lastVocAnomaly = 0;

// Helpers
const randn = () => {
  // Box-Muller transform for normal distribution
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
};

function generateReading(now: Date) {
  // Hours past midnight as a continuous value [0, 24)
  const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;

  // Diurnal temperature cycle: low ~5am (16°C), high ~3pm (24°C)
  const phase = ((hours - 5) / 24) * 2 * Math.PI;
  const tempBase = 20 + 4 * Math.sin(phase);
  const tempC = +(tempBase + 0.3 * randn()).toFixed(2);

  // Humidity: inverse of temperature roughly, plus noise
  const humidityBase = 60 - (tempBase - 20) * 2;
  const humidity = +Math.max(20, Math.min(95, humidityBase + 1.5 * randn())).toFixed(2);

  // Pressure: slow random walk
  pressureHpa += 0.05 * randn();
  pressureHpa = Math.max(990, Math.min(1035, pressureHpa));

  // VOC: usually high resistance ~50-100 kOhm; occasional drops to 10-20 kOhm
  const sinceLastAnomaly = Date.now() - lastVocAnomaly;
  const triggerAnomaly = Math.random() < 0.005 && sinceLastAnomaly > 60000;
  if (triggerAnomaly) lastVocAnomaly = Date.now();
  const inAnomaly = sinceLastAnomaly < 30000;
  const vocBase = inAnomaly ? 15000 : 75000;
  const vocOhms = Math.round(vocBase + 8000 * randn());

  return {
    device: DEVICE_UID,
    when: Math.floor(now.getTime() / 1000),
    file: "env.qo",
    body: {
      temp_c: tempC,
      humidity,
      pressure_hpa: +pressureHpa.toFixed(2),
      voc_ohms: vocOhms,
    },
  };
}

async function postReading() {
  const reading = generateReading(new Date());
  try {
    const res = await fetch(INGEST_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Notehub-Secret": SECRET!,
      },
      body: JSON.stringify(reading),
    });
    const data = await res.json();
    if (!res.ok) {
      console.warn(`✗ ${res.status}`, data);
    } else {
      const t = reading.body.temp_c.toFixed(1).padStart(5);
      const h = reading.body.humidity.toFixed(1).padStart(5);
      console.log(`✓ temp=${t}°C  hum=${h}%  voc=${reading.body.voc_ohms}Ω  id=${data.id?.slice(-8) ?? "?"}`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`✗ network error: ${msg}`);
  }
}

console.log(`simulator: posting to ${INGEST_URL}`);
console.log(`           device=${DEVICE_UID}  interval=${INTERVAL_MS}ms`);
console.log(`           Ctrl+C to stop\n`);

postReading();
setInterval(postReading, INTERVAL_MS);

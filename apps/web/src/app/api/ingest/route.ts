import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { evaluateDeviceAlarms } from '@/lib/alarmStore';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

// POST /api/ingest
// Receives one Notehub event per reading. Each sensor node (Swan + Notecard)
// sends a dht11.qo note: { temperature_c, humidity_pct, probe_temp_c? }.
export async function POST(request: NextRequest) {
  try {
    const event = await request.json();
    console.log('Received webhook:', JSON.stringify(event));

    // Notehub device UID, e.g. "dev:351077454469720"
    const deviceUid: string = event.device || event.deviceUID || 'dev:notecard-001';
    const sensorData = event.body || event;

    // Notehub sends the capture time as a Unix timestamp in seconds
    const capturedAt = event.when ? new Date(event.when * 1000) : new Date();

    // Accept both the firmware's names and the simulator's names
    const tempC = num(sensorData.temperature_c) ?? num(sensorData.temp) ?? num(sensorData.temperature);
    const humidity = num(sensorData.humidity_pct) ?? num(sensorData.humidity);
    if (tempC === null || humidity === null) {
      return NextResponse.json(
        { error: 'Missing temperature_c or humidity_pct in note body' },
        { status: 400 }
      );
    }

    // Reject values a DHT11 cannot physically report (corrupted reads can
    // slip through its checksum as near-zero temperature and 0 % humidity)
    if (humidity < 5 || humidity > 100 || tempC < -10 || tempC > 60) {
      return NextResponse.json(
        { error: 'Implausible DHT11 reading rejected', tempC, humidity },
        { status: 422 }
      );
    }

    const reading = await prisma.envReading.create({
      data: {
        deviceUid,
        capturedAt,
        ingestedAt: new Date(),
        receivedAt: new Date(),
        tempC,
        humidity,
        pressureHpa: num(sensorData.pressure),
        vocOhms: num(sensorData.voc),
        probeTempC: num(sensorData.probe_temp_c), // DS18B20 water probe
      },
    });

    // Register the node the first time it posts. If the device has a serial
    // number set in Notehub (Devices -> device -> Settings), it becomes the
    // label shown on the dashboard, e.g. "Ice cup".
    const sn = typeof event.sn === 'string' && event.sn.trim() ? event.sn.trim().slice(0, 60) : null;
    try {
      await prisma.device.upsert({
        where: { deviceUid },
        create: { deviceUid, label: sn ?? `Node ${deviceUid.slice(-4)}`, sortOrder: 50 },
        update: sn ? { label: sn } : {},
      });
    } catch (e) {
      // Never lose a reading because of the device registry
      console.error('Device upsert failed:', e);
    }

    // Temperature alarms: freezer failure and room heating, on 5-minute means
    try {
      await evaluateDeviceAlarms(deviceUid, capturedAt);
    } catch (e) {
      console.error('Alarm check failed:', e);
    }

    return NextResponse.json({
      success: true,
      readingId: reading.id,
      deviceUid,
      tempC: reading.tempC,
      humidity: reading.humidity,
      probeTempC: reading.probeTempC,
    });
  } catch (error) {
    console.error('Ingest error:', error);
    return NextResponse.json(
      {
        error: 'Failed to ingest data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

// GET /api/ingest — health check
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'bayes-iot-ingest',
    timestamp: new Date().toISOString(),
  });
}

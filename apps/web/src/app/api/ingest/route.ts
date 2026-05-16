import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// POST /api/ingest
// Receives data from Blues Notehub webhook
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Blues Notehub sends data in this format:
    // { event: "...", body: { temp: 22.5, humidity: 55.2, ... } }

    console.log('Received webhook:', JSON.stringify(body, null, 2));

    // Extract device ID from Notehub event
    const deviceUid = body.device || body.deviceUID || 'dev:notecard-001';

    // Extract sensor data from body
    const sensorData = body.body || body;

    // Parse timestamps
    const capturedAt = body.when
      ? new Date(body.when * 1000) // Notehub sends Unix timestamp
      : new Date();

    // Create reading in database
    const reading = await prisma.envReading.create({
      data: {
        deviceUid,
        capturedAt,
        ingestedAt: new Date(),
        receivedAt: new Date(),
        tempC: sensorData.temperature_c || sensorData.temp || sensorData.temperature || 0,
        humidity: sensorData.humidity_pct || sensorData.humidity || 0,
        pressureHpa: sensorData.pressure || null,
        vocOhms: sensorData.voc || null,
      },
    });

    console.log('✓ Created reading:', reading.id);

    return NextResponse.json({
      success: true,
      readingId: reading.id,
      deviceUid,
      tempC: reading.tempC,
      humidity: reading.humidity,
    });

  } catch (error) {
    console.error('Ingest error:', error);
    return NextResponse.json(
      {
        error: 'Failed to ingest data',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET /api/ingest
// Health check endpoint
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    service: 'bayes-iot-ingest',
    timestamp: new Date().toISOString(),
  });
}

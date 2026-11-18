// GET /api/nodes?limit=120
// Every registered sensor node with its most recent readings (oldest first),
// so the dashboard can draw one line per node instead of mixing them.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 120) || 120, 10), 1000);

  try {
    const devices = await prisma.device.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const nodes = await Promise.all(
      devices.map(async (d: { deviceUid: string; label: string; site: string }) => {
        const rows = await prisma.envReading.findMany({
          where: { deviceUid: d.deviceUid },
          orderBy: { capturedAt: 'desc' },
          take: limit,
          select: { capturedAt: true, tempC: true, humidity: true, probeTempC: true },
        });
        return {
          deviceUid: d.deviceUid,
          label: d.label,
          site: d.site,
          readings: rows.reverse(),
        };
      })
    );

    return NextResponse.json({ nodes, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching nodes:', error);
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 });
  }
}

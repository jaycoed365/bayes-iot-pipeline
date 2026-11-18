// GET /api/nodes?hours=12&limit=720
// Every registered sensor node with its readings from the last N hours (oldest
// first), so the dashboard draws one line per node and a node that has gone
// quiet does not drag months-old data onto the charts. lastSeen is reported
// separately so a silent node still shows when it last reported.

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get('limit') ?? 720) || 720, 10), 2000);
  const hours = Math.min(Math.max(Number(searchParams.get('hours') ?? 12) || 12, 1), 168);
  const since = new Date(Date.now() - hours * 3600 * 1000);

  try {
    const devices = await prisma.device.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });

    const nodes = await Promise.all(
      devices.map(async (d: { deviceUid: string; label: string; site: string }) => {
        const [rows, last] = await Promise.all([
          prisma.envReading.findMany({
            where: { deviceUid: d.deviceUid, capturedAt: { gte: since } },
            orderBy: { capturedAt: 'desc' },
            take: limit,
            select: { capturedAt: true, tempC: true, humidity: true, probeTempC: true },
          }),
          prisma.envReading.findFirst({
            where: { deviceUid: d.deviceUid },
            orderBy: { capturedAt: 'desc' },
            select: { capturedAt: true },
          }),
        ]);
        return {
          deviceUid: d.deviceUid,
          label: d.label,
          site: d.site,
          lastSeen: last?.capturedAt ?? null,
          readings: rows.reverse(),
        };
      })
    );

    return NextResponse.json({ nodes, windowHours: hours, generatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error fetching nodes:', error);
    return NextResponse.json({ error: 'Failed to fetch nodes' }, { status: 500 });
  }
}

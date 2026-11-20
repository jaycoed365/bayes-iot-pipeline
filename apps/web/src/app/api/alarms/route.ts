import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/alarms — open alarms, plus every alarm from the last 24 hours
export async function GET() {
  try {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [active, recent, devices, rulesWatching] = await Promise.all([
      prisma.alarm.findMany({ where: { clearedAt: null }, orderBy: { triggeredAt: 'desc' } }),
      prisma.alarm.findMany({ where: { triggeredAt: { gt: since } }, orderBy: { triggeredAt: 'desc' }, take: 50 }),
      prisma.device.findMany(),
      prisma.alarmRule.count({ where: { enabled: true } }),
    ]);
    const labels = new Map(devices.map((d: { deviceUid: string; label: string }) => [d.deviceUid, d.label] as [string, string]));
    const withLabel = (a: { deviceUid: string }) => ({ ...a, label: labels.get(a.deviceUid) ?? a.deviceUid });
    return NextResponse.json({
      active: active.map(withLabel),
      recent: recent.map(withLabel),
      pushEnabled: Boolean(process.env.NTFY_TOPIC),
      rulesWatching,
    });
  } catch (error) {
    console.error('Alarms error:', error);
    return NextResponse.json({ error: 'Failed to load alarms' }, { status: 500 });
  }
}

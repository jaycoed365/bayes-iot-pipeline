import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPin, pinRequired } from '@/lib/adminPin';
import { validateRule, type Channel, type Condition } from '@/lib/alarms';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const MAX_RULES = 20;

// GET /api/alarm-rules — every rule, plus the nodes a rule can target
export async function GET(request: NextRequest) {
  const denied = checkPin(request);
  if (denied) return denied;
  try {
    const [rules, devices] = await Promise.all([
      prisma.alarmRule.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
      prisma.device.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    ]);
    return NextResponse.json({
      rules,
      devices: devices.map((d: { deviceUid: string; label: string }) => ({ deviceUid: d.deviceUid, label: d.label })),
      pinRequired: pinRequired(),
      pushEnabled: Boolean(process.env.NTFY_TOPIC),
    });
  } catch (error) {
    console.error('Alarm rules error:', error);
    return NextResponse.json({ error: 'Failed to load alarm rules' }, { status: 500 });
  }
}

// POST /api/alarm-rules — add a rule
export async function POST(request: NextRequest) {
  const denied = checkPin(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const spec = {
      channel: body.channel as Channel,
      condition: body.condition as Condition,
      threshold: Number(body.threshold),
      windowMin: Number(body.windowMin ?? 5),
    };
    const invalid = validateRule(spec);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    const deviceUid = typeof body.deviceUid === 'string' && body.deviceUid ? body.deviceUid : null;
    if (deviceUid && !(await prisma.device.findUnique({ where: { deviceUid } }))) {
      return NextResponse.json({ error: 'unknown node' }, { status: 400 });
    }
    if ((await prisma.alarmRule.count()) >= MAX_RULES) {
      return NextResponse.json({ error: `at most ${MAX_RULES} rules` }, { status: 400 });
    }
    const last = await prisma.alarmRule.findFirst({ orderBy: { sortOrder: 'desc' } });
    const rule = await prisma.alarmRule.create({
      data: {
        ...spec,
        deviceUid,
        enabled: body.enabled !== false,
        push: body.push !== false,
        sortOrder: (last?.sortOrder ?? 0) + 1,
      },
    });
    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Alarm rule create error:', error);
    return NextResponse.json({ error: 'Failed to add rule' }, { status: 500 });
  }
}

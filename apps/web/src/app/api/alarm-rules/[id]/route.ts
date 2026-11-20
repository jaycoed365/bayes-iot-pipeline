import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkPin } from '@/lib/adminPin';
import { validateRule, type Channel, type Condition } from '@/lib/alarms';

export const dynamic = 'force-dynamic';

// Close any alarm the rule has open, so the new settings start fresh
async function closeOpenAlarms(ruleId: string) {
  await prisma.alarm.updateMany({ where: { ruleId, clearedAt: null }, data: { clearedAt: new Date() } });
}

// PATCH /api/alarm-rules/:id — change a rule
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = checkPin(request);
  if (denied) return denied;
  try {
    const existing = await prisma.alarmRule.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: 'rule not found' }, { status: 404 });

    const body = await request.json();
    const spec = {
      channel: (body.channel ?? existing.channel) as Channel,
      condition: (body.condition ?? existing.condition) as Condition,
      threshold: body.threshold !== undefined ? Number(body.threshold) : existing.threshold,
      windowMin: body.windowMin !== undefined ? Number(body.windowMin) : existing.windowMin,
    };
    const invalid = validateRule(spec);
    if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

    let deviceUid: string | null = existing.deviceUid;
    if (body.deviceUid !== undefined) {
      deviceUid = typeof body.deviceUid === 'string' && body.deviceUid ? body.deviceUid : null;
      if (deviceUid && !(await prisma.device.findUnique({ where: { deviceUid } }))) {
        return NextResponse.json({ error: 'unknown node' }, { status: 400 });
      }
    }

    const rule = await prisma.alarmRule.update({
      where: { id: params.id },
      data: {
        ...spec,
        deviceUid,
        enabled: typeof body.enabled === 'boolean' ? body.enabled : existing.enabled,
        push: typeof body.push === 'boolean' ? body.push : existing.push,
      },
    });
    await closeOpenAlarms(params.id);
    return NextResponse.json({ rule });
  } catch (error) {
    console.error('Alarm rule update error:', error);
    return NextResponse.json({ error: 'Failed to update rule' }, { status: 500 });
  }
}

// DELETE /api/alarm-rules/:id — remove a rule
export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const denied = checkPin(request);
  if (denied) return denied;
  try {
    await closeOpenAlarms(params.id);
    await prisma.alarmRule.delete({ where: { id: params.id } });
    return NextResponse.json({ deleted: params.id });
  } catch (error) {
    console.error('Alarm rule delete error:', error);
    return NextResponse.json({ error: 'Failed to delete rule' }, { status: 500 });
  }
}

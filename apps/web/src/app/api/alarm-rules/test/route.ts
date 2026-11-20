import { NextRequest, NextResponse } from 'next/server';
import { checkPin } from '@/lib/adminPin';
import { pushAlarm } from '@/lib/notify';

export const dynamic = 'force-dynamic';

// POST /api/alarm-rules/test — send a test notification to the ntfy topic
export async function POST(request: NextRequest) {
  const denied = checkPin(request);
  if (denied) return denied;
  if (!process.env.NTFY_TOPIC) {
    return NextResponse.json({ sent: false, error: 'NTFY_TOPIC is not set in the environment' }, { status: 400 });
  }
  const sent = await pushAlarm('Bayes-IoT test', 'Test alarm from the dashboard. If you can read this, push works.', { resolved: true });
  return NextResponse.json({ sent }, { status: sent ? 200 : 502 });
}

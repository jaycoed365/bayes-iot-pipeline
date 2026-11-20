// Optional PIN for the alarm settings. When ALARM_ADMIN_PIN is set in the
// environment, every alarm-rule request must send it in the x-alarm-pin
// header. When it is not set, the settings are open (handy for a demo).
import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export const pinRequired = () => Boolean(process.env.ALARM_ADMIN_PIN);

export function checkPin(request: NextRequest): NextResponse | null {
  const expected = process.env.ALARM_ADMIN_PIN;
  if (!expected) return null;
  const given = request.headers.get('x-alarm-pin') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length === b.length && timingSafeEqual(a, b)) return null;
  return NextResponse.json({ error: 'PIN required', pinRequired: true }, { status: 401 });
}

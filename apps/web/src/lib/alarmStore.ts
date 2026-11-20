// Runs the enabled alarm rules for one device after each reading, opens or
// closes alarm episodes in the database, and sends a phone push when one
// opens or clears.
import { prisma } from '@/lib/prisma';
import {
  COOLDOWN_MIN, evaluateRule, lookbackMin, describeRule,
  type AlarmPoint, type Channel, type Condition,
} from '@/lib/alarms';
import { pushAlarm } from '@/lib/notify';

interface RuleRow {
  id: string;
  deviceUid: string | null;
  channel: string;
  condition: string;
  threshold: number;
  windowMin: number;
  push: boolean;
}

export async function evaluateDeviceAlarms(deviceUid: string, at: Date) {
  const rules: RuleRow[] = await prisma.alarmRule.findMany({
    where: { enabled: true, OR: [{ deviceUid: null }, { deviceUid }] },
  });
  if (rules.length === 0) return;

  const device = await prisma.device.findUnique({ where: { deviceUid } });
  const label = device?.label ?? `Node ${deviceUid.slice(-4)}`;

  const lookback = Math.max(...rules.map((r) => lookbackMin(r.windowMin)));
  const rows = await prisma.envReading.findMany({
    where: { deviceUid, capturedAt: { gt: new Date(at.getTime() - lookback * 60000), lte: at } },
    select: { capturedAt: true, tempC: true, humidity: true, probeTempC: true },
    orderBy: { capturedAt: 'asc' },
  });
  const points: AlarmPoint[] = rows.map(
    (r: { capturedAt: Date; tempC: number; humidity: number; probeTempC: number | null }) => ({
      t: r.capturedAt.getTime(),
      air: r.tempC,
      humidity: r.humidity,
      water: r.probeTempC,
    })
  );

  for (const rule of rules) {
    const spec = {
      channel: rule.channel as Channel,
      condition: rule.condition as Condition,
      threshold: rule.threshold,
      windowMin: rule.windowMin,
    };
    const check = evaluateRule(spec, label, points);
    const open = await prisma.alarm.findFirst({
      where: { deviceUid, ruleId: rule.id, clearedAt: null },
      orderBy: { triggeredAt: 'desc' },
    });

    if (check.active && !open) {
      const recent = await prisma.alarm.findFirst({
        where: { deviceUid, ruleId: rule.id, triggeredAt: { gt: new Date(at.getTime() - COOLDOWN_MIN * 60000) } },
      });
      if (recent) continue; // it just cleared; don't flap
      const alarm = await prisma.alarm.create({
        data: {
          deviceUid,
          ruleId: rule.id,
          kind: `${rule.channel}_${rule.condition}`,
          message: check.message,
          value: check.value,
          rate: check.rate,
          triggeredAt: at,
        },
      });
      if (rule.push) {
        const sent = await pushAlarm(
          `Bayes-IoT alarm: ${label}`,
          `${check.message}\nRule: ${describeRule(spec)}`
        );
        if (sent) await prisma.alarm.update({ where: { id: alarm.id }, data: { notified: true } });
      }
    } else if (check.active && open) {
      // Still going: keep the latest numbers on the open episode
      await prisma.alarm.update({
        where: { id: open.id },
        data: { message: check.message, value: check.value, rate: check.rate },
      });
    } else if (!check.active && open && check.clear) {
      await prisma.alarm.update({ where: { id: open.id }, data: { clearedAt: at } });
      if (rule.push) {
        await pushAlarm(`Bayes-IoT cleared: ${label}`, `${label}: back to normal. Rule: ${describeRule(spec)}`, { resolved: true });
      }
    }
  }
}

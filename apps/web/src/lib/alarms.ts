// Temperature and humidity alarms. Pure functions (no database), so they can
// be tested on simulated data. Rules come from the AlarmRule table and are
// edited on the dashboard; alarmStore.ts handles storage and push.
//
// Every rule works on window means, not single readings: averaging first cuts
// the sensor noise (about 11x in the rate for 5-minute means, see the deck),
// which keeps one noisy reading from waking someone up.

export interface AlarmPoint {
  t: number; // epoch ms (capture time)
  air: number; // DHT11 air temperature, °C
  humidity: number; // DHT11 relative humidity, %
  water: number | null; // DS18B20 probe, °C (null if unplugged)
}

export const CHANNELS = ['water', 'air', 'humidity'] as const;
export const CONDITIONS = ['above', 'below', 'rising', 'falling'] as const;
export const WINDOWS = [1, 5, 15] as const;
export type Channel = (typeof CHANNELS)[number];
export type Condition = (typeof CONDITIONS)[number];

export interface RuleSpec {
  channel: Channel;
  condition: Condition;
  threshold: number; // level in °C or %, or a rate in °C/min or %/min (always positive)
  windowMin: number; // length of each mean, minutes
}

export interface RuleResult {
  active: boolean; // condition is true now
  clear: boolean; // condition is safely false (with hysteresis)
  value: number | null; // latest window mean
  rate: number | null; // per minute, between two window means
  message: string;
}

export const COOLDOWN_MIN = 30; // no new episode of the same rule within this time

export const unitOf = (channel: Channel) => (channel === 'humidity' ? '%' : '°C');
export const isRate = (c: Condition) => c === 'rising' || c === 'falling';
// Hysteresis for level rules: clear only this far back inside the safe side
const levelMargin = (channel: Channel) => (channel === 'humidity' ? 5 : 2);

// The rate compares the latest mean with the mean two windows earlier, so
// the two windows never overlap: 5-min means 10 minutes apart, as in the deck.
export const rateSpanMin = (windowMin: number) => 2 * windowMin;
export const lookbackMin = (windowMin: number) => windowMin + rateSpanMin(windowMin) + 1;
const minPoints = (windowMin: number) => Math.max(1, Math.ceil(windowMin * 0.6));

export function pick(channel: Channel) {
  return (p: AlarmPoint): number | null =>
    channel === 'water' ? p.water : channel === 'air' ? p.air : p.humidity;
}

function windowMean(points: AlarmPoint[], end: number, windowMin: number, get: (p: AlarmPoint) => number | null) {
  const start = end - windowMin * 60000;
  const vals = points
    .filter((p) => p.t > start && p.t <= end)
    .map(get)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length < minPoints(windowMin)) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

//   mean = T̄_w(now)
//   rate = (T̄_w(now) − T̄_w(now − 2w)) / 2w
export function meanAndRate(points: AlarmPoint[], windowMin: number, get: (p: AlarmPoint) => number | null) {
  if (points.length === 0) return { mean: null, rate: null };
  const now = Math.max(...points.map((p) => p.t));
  const span = rateSpanMin(windowMin);
  const mean = windowMean(points, now, windowMin, get);
  const earlier = windowMean(points, now - span * 60000, windowMin, get);
  const rate = mean !== null && earlier !== null ? (mean - earlier) / span : null;
  return { mean, rate };
}

export function describeRule(r: RuleSpec) {
  const u = unitOf(r.channel);
  const what = `${r.channel} (${r.windowMin}-min mean)`;
  switch (r.condition) {
    case 'above': return `${what} above ${r.threshold} ${u}`;
    case 'below': return `${what} below ${r.threshold} ${u}`;
    case 'rising': return `${what} rising faster than ${r.threshold} ${u}/min`;
    case 'falling': return `${what} falling faster than ${r.threshold} ${u}/min`;
  }
}

export function evaluateRule(rule: RuleSpec, label: string, points: AlarmPoint[]): RuleResult {
  const { mean, rate } = meanAndRate(points, rule.windowMin, pick(rule.channel));
  const u = unitOf(rule.channel);
  const th = rule.threshold;
  let active = false;
  let clear = false;
  let detail = '';

  switch (rule.condition) {
    case 'above':
      active = mean !== null && mean > th;
      clear = mean !== null && mean < th - levelMargin(rule.channel);
      if (mean !== null) detail = `${mean.toFixed(1)} ${u}, above ${th} ${u}`;
      break;
    case 'below':
      active = mean !== null && mean < th;
      clear = mean !== null && mean > th + levelMargin(rule.channel);
      if (mean !== null) detail = `${mean.toFixed(1)} ${u}, below ${th} ${u}`;
      break;
    case 'rising':
      active = rate !== null && rate > th;
      clear = rate !== null && rate < th / 2;
      if (rate !== null) detail = `rising ${rate.toFixed(2)} ${u}/min, limit ${th}`;
      break;
    case 'falling':
      active = rate !== null && rate < -th;
      clear = rate !== null && rate > -th / 2;
      if (rate !== null) detail = `falling ${Math.abs(rate).toFixed(2)} ${u}/min, limit ${th}`;
      break;
  }

  return { active, clear, value: mean, rate, message: `${label}: ${rule.channel} ${detail}.` };
}

// Server-side check of a rule sent from the dashboard. Returns an error
// message, or null when the rule is acceptable.
export function validateRule(r: Partial<RuleSpec>): string | null {
  if (!CHANNELS.includes(r.channel as Channel)) return 'channel must be water, air or humidity';
  if (!CONDITIONS.includes(r.condition as Condition)) return 'condition must be above, below, rising or falling';
  if (!WINDOWS.includes(r.windowMin as (typeof WINDOWS)[number])) return 'window must be 1, 5 or 15 minutes';
  const th = r.threshold;
  if (typeof th !== 'number' || !Number.isFinite(th)) return 'threshold must be a number';
  if (isRate(r.condition as Condition)) {
    if (th <= 0 || th > 10) return 'rate threshold must be between 0 and 10 per minute';
  } else if (r.channel === 'humidity') {
    if (th < 0 || th > 100) return 'humidity threshold must be between 0 and 100 %';
  } else if (th < -60 || th > 100) {
    return 'temperature threshold must be between −60 and 100 °C';
  }
  return null;
}

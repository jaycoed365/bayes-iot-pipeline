// Event detection and curve fitting for the ice-cup / room-cup experiment.
// Pure functions (no database), so they can be tested on synthetic data.

export interface WaterPoint {
  t: number; // epoch milliseconds (minute-averaged)
  w: number; // water temperature, °C
}

export type EventKind = 'plateau_start' | 'plateau_end' | 'cross_zero' | 'node_silent';

export interface NodeEvent {
  deviceUid: string;
  label: string;
  kind: EventKind;
  at: string; // ISO time
  message: string;
}

export interface PlateauSummary {
  start: string;
  end: string | null; // null while the ice is still melting
  minutes: number; // duration so far
}

export interface TimeConstantFit {
  tauMinutes: number; // first-order time constant
  tInfC: number; // temperature the water is approaching
  r2: number; // fit quality of ln(T_inf - T) vs t
  points: number;
}

// Ice-water sits near 0 °C while it melts. The DS18B20 is rated ±0.5 °C,
// so the plateau band is a little wider than that.
export const PLATEAU_LOW_C = -1.0;
export const PLATEAU_HIGH_C = 1.0;
export const PLATEAU_EXIT_C = 1.5; // above this after the plateau = melting is done
export const PLATEAU_MIN_POINTS = 5; // ~5 minutes in band before we call it a plateau
export const SILENT_AFTER_MIN = 10;

/**
 * Walks one node's minute-averaged water series and finds:
 *  - when it first crossed 0 °C going up (thawing a frozen cup)
 *  - when it settled on the 0 °C melting plateau
 *  - when it left the plateau (all ice melted), and how long the plateau lasted
 */
export function detectWaterEvents(
  deviceUid: string,
  label: string,
  points: WaterPoint[]
): { events: NodeEvent[]; plateau: PlateauSummary | null; plateauEndT: number | null } {
  const events: NodeEvent[] = [];
  let crossedZero = false;
  let runStart: number | null = null;
  let runLength = 0;
  let plateauStartT: number | null = null;
  let plateauEndT: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = i > 0 ? points[i - 1] : null;

    if (!crossedZero && prev && prev.w < 0 && p.w >= 0) {
      crossedZero = true;
      events.push({
        deviceUid, label, kind: 'cross_zero', at: new Date(p.t).toISOString(),
        message: `${label} warmed through 0 °C`,
      });
    }

    if (plateauStartT === null) {
      if (p.w >= PLATEAU_LOW_C && p.w <= PLATEAU_HIGH_C) {
        if (runStart === null) runStart = p.t;
        runLength++;
        if (runLength >= PLATEAU_MIN_POINTS) {
          plateauStartT = runStart;
          events.push({
            deviceUid, label, kind: 'plateau_start', at: new Date(runStart).toISOString(),
            message: `${label} reached the 0 °C melting plateau`,
          });
        }
      } else {
        runStart = null;
        runLength = 0;
      }
    } else if (plateauEndT === null && p.w > PLATEAU_EXIT_C) {
      plateauEndT = p.t;
      const mins = Math.round((plateauEndT - plateauStartT) / 60000);
      events.push({
        deviceUid, label, kind: 'plateau_end', at: new Date(p.t).toISOString(),
        message: `${label} left the plateau: ice melted after ${mins} min`,
      });
    }
  }

  let plateau: PlateauSummary | null = null;
  if (plateauStartT !== null) {
    const endOrNow = plateauEndT ?? (points.length ? points[points.length - 1].t : plateauStartT);
    plateau = {
      start: new Date(plateauStartT).toISOString(),
      end: plateauEndT !== null ? new Date(plateauEndT).toISOString() : null,
      minutes: Math.round((endOrNow - plateauStartT) / 60000),
    };
  }
  return { events, plateau, plateauEndT };
}

/**
 * Fits Newton's law of heating, T(t) = T_inf - (T_inf - T0) e^(-t/tau),
 * by linear regression of ln(T_inf - T) against t. The slope is -1/tau.
 */
export function fitTimeConstant(points: WaterPoint[], tInfC: number): TimeConstantFit | null {
  const usable = points.filter((p) => tInfC - p.w > 0.5);
  if (usable.length < 10) return null;

  const t0 = usable[0].t;
  const xs = usable.map((p) => (p.t - t0) / 60000); // minutes
  const ys = usable.map((p) => Math.log(tInfC - p.w));
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (sxx === 0 || syy === 0) return null;
  const slope = sxy / sxx;
  if (slope >= 0) return null; // not warming toward T_inf
  const r2 = (sxy * sxy) / (sxx * syy);
  return { tauMinutes: -1 / slope, tInfC, r2, points: n };
}

export function silentNodeEvent(
  deviceUid: string,
  label: string,
  lastSeen: Date | null,
  now = new Date()
): NodeEvent | null {
  if (!lastSeen) return null;
  const mins = (now.getTime() - lastSeen.getTime()) / 60000;
  if (mins < SILENT_AFTER_MIN) return null;
  return {
    deviceUid, label, kind: 'node_silent', at: lastSeen.toISOString(),
    message: `${label} has not reported for ${Math.round(mins)} min`,
  };
}

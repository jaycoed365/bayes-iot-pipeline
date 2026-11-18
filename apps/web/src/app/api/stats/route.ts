// GET /api/stats?hours=24
// Server-side aggregation over the last N hours:
//   temporal      — hourly mean / min / max per node
//   per node      — summary stats, water-minus-air offset, air/water correlation
//   hierarchical  — node -> site rollup
//   cross-sensor  — node-vs-node water and air comparison (minute-aligned)
//   event-driven  — melting plateau, 0 °C crossing, silent nodes
//   physics       — first-order warming time constant of a melted cup

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  detectWaterEvents,
  fitTimeConstant,
  silentNodeEvent,
  type NodeEvent,
  type WaterPoint,
} from '@/lib/aggregation';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface NodeSummaryRow {
  deviceUid: string; label: string; site: string; n: number; lastSeen: Date | null;
  airMean: number | null; airMin: number | null; airMax: number | null; airSd: number | null;
  waterMean: number | null; waterMin: number | null; waterMax: number | null; waterSd: number | null;
  rhMean: number | null; waterMinusAir: number | null; airWaterCorr: number | null;
}
interface HourlyRow {
  deviceUid: string; hour: Date; n: number;
  airMean: number | null; airMin: number | null; airMax: number | null;
  waterMean: number | null; waterMin: number | null; waterMax: number | null; rhMean: number | null;
}
interface SiteRow {
  site: string; nodes: number; n: number;
  airMean: number | null; waterMean: number | null; waterMin: number | null; waterMax: number | null;
}
interface PairRow {
  aUid: string; bUid: string; n: number;
  waterDiffMean: number | null; waterDiffSd: number | null; waterCorr: number | null;
  airDiffMean: number | null; airCorr: number | null;
}
interface MinuteRow { deviceUid: string; t: Date; w: number | null; a: number | null }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hours = Math.min(Math.max(Number(searchParams.get('hours') ?? 24) || 24, 1), 168);
  const since = new Date(Date.now() - hours * 3600 * 1000);

  try {
    // Everything joins on "Device", so simulator and test rows that were
    // never registered as nodes are left out of the statistics.
    const nodes = await prisma.$queryRaw<NodeSummaryRow[]>`
      SELECT r."deviceUid", d.label, d.site,
             COUNT(*)::int                              AS n,
             MAX(r."capturedAt")                        AS "lastSeen",
             AVG(r."tempC")::float8                     AS "airMean",
             MIN(r."tempC")::float8                     AS "airMin",
             MAX(r."tempC")::float8                     AS "airMax",
             STDDEV_SAMP(r."tempC")::float8             AS "airSd",
             AVG(r."probeTempC")::float8                AS "waterMean",
             MIN(r."probeTempC")::float8                AS "waterMin",
             MAX(r."probeTempC")::float8                AS "waterMax",
             STDDEV_SAMP(r."probeTempC")::float8        AS "waterSd",
             AVG(r.humidity)::float8                    AS "rhMean",
             AVG(r."probeTempC" - r."tempC")::float8    AS "waterMinusAir",
             CORR(r."probeTempC", r."tempC")::float8    AS "airWaterCorr"
      FROM "EnvReading" r
      JOIN "Device" d ON d."deviceUid" = r."deviceUid"
      WHERE r."capturedAt" > ${since}
      GROUP BY r."deviceUid", d.label, d.site, d."sortOrder"
      ORDER BY d."sortOrder", d.label`;

    const hourly = await prisma.$queryRaw<HourlyRow[]>`
      SELECT r."deviceUid",
             date_trunc('hour', r."capturedAt")   AS hour,
             COUNT(*)::int                        AS n,
             AVG(r."tempC")::float8               AS "airMean",
             MIN(r."tempC")::float8               AS "airMin",
             MAX(r."tempC")::float8               AS "airMax",
             AVG(r."probeTempC")::float8          AS "waterMean",
             MIN(r."probeTempC")::float8          AS "waterMin",
             MAX(r."probeTempC")::float8          AS "waterMax",
             AVG(r.humidity)::float8              AS "rhMean"
      FROM "EnvReading" r
      JOIN "Device" d ON d."deviceUid" = r."deviceUid"
      WHERE r."capturedAt" > ${since}
      GROUP BY 1, 2
      ORDER BY 2, 1`;

    const sites = await prisma.$queryRaw<SiteRow[]>`
      SELECT d.site,
             COUNT(DISTINCT r."deviceUid")::int   AS nodes,
             COUNT(*)::int                        AS n,
             AVG(r."tempC")::float8               AS "airMean",
             AVG(r."probeTempC")::float8          AS "waterMean",
             MIN(r."probeTempC")::float8          AS "waterMin",
             MAX(r."probeTempC")::float8          AS "waterMax"
      FROM "EnvReading" r
      JOIN "Device" d ON d."deviceUid" = r."deviceUid"
      WHERE r."capturedAt" > ${since}
      GROUP BY d.site
      ORDER BY d.site`;

    // Minute buckets line up two nodes that report on their own clocks
    const minutes = await prisma.$queryRaw<MinuteRow[]>`
      SELECT r."deviceUid",
             date_trunc('minute', r."capturedAt") AS t,
             AVG(r."probeTempC")::float8          AS w,
             AVG(r."tempC")::float8               AS a
      FROM "EnvReading" r
      JOIN "Device" d ON d."deviceUid" = r."deviceUid"
      WHERE r."capturedAt" > ${since}
      GROUP BY 1, 2
      ORDER BY 1, 2`;

    const pairs = await prisma.$queryRaw<PairRow[]>`
      WITH m AS (
        SELECT r."deviceUid",
               date_trunc('minute', r."capturedAt") AS t,
               AVG(r."probeTempC") AS w,
               AVG(r."tempC")      AS a
        FROM "EnvReading" r
        JOIN "Device" d ON d."deviceUid" = r."deviceUid"
        WHERE r."capturedAt" > ${since}
        GROUP BY 1, 2
      )
      SELECT x."deviceUid" AS "aUid", y."deviceUid" AS "bUid",
             COUNT(*)::int                       AS n,
             AVG(x.w - y.w)::float8              AS "waterDiffMean",
             STDDEV_SAMP(x.w - y.w)::float8      AS "waterDiffSd",
             CORR(x.w, y.w)::float8              AS "waterCorr",
             AVG(x.a - y.a)::float8              AS "airDiffMean",
             CORR(x.a, y.a)::float8              AS "airCorr"
      FROM m x
      JOIN m y ON x.t = y.t AND x."deviceUid" < y."deviceUid"
      GROUP BY 1, 2`;

    // Event detection and the time-constant fit run per node in TypeScript
    const labelOf = new Map(nodes.map((n: NodeSummaryRow) => [n.deviceUid, n.label]));
    const events: NodeEvent[] = [];
    const plateaus: Record<string, unknown> = {};
    const timeConstants: Record<string, unknown> = {};
    const now = new Date();

    for (const node of nodes) {
      const series: WaterPoint[] = minutes
        .filter((m: MinuteRow) => m.deviceUid === node.deviceUid && m.w !== null)
        .map((m: MinuteRow) => ({ t: new Date(m.t).getTime(), w: m.w as number }));
      const label = labelOf.get(node.deviceUid) ?? node.deviceUid;

      const det = detectWaterEvents(node.deviceUid, label, series);
      events.push(...det.events);
      if (det.plateau) plateaus[node.deviceUid] = det.plateau;

      // After the ice is gone the water warms toward the air beside it
      if (det.plateauEndT !== null && node.airMean !== null) {
        const recentAir = minutes
          .filter((m: MinuteRow) => m.deviceUid === node.deviceUid && m.a !== null)
          .slice(-60)
          .map((m: MinuteRow) => m.a as number);
        const tInf = recentAir.length
          ? recentAir.reduce((s: number, v: number) => s + v, 0) / recentAir.length
          : node.airMean;
        const fit = fitTimeConstant(series.filter((p) => p.t >= (det.plateauEndT as number)), tInf);
        if (fit) timeConstants[node.deviceUid] = fit;
      }

      const silent = silentNodeEvent(
        node.deviceUid, label, node.lastSeen ? new Date(node.lastSeen) : null, now
      );
      if (silent) events.push(silent);
    }
    events.sort((a, b) => a.at.localeCompare(b.at));

    return NextResponse.json({
      windowHours: hours,
      since: since.toISOString(),
      generatedAt: now.toISOString(),
      nodes,
      hourly,
      sites,
      pairs,
      events,
      plateaus,
      timeConstants,
    });
  } catch (error) {
    console.error('Error computing stats:', error);
    return NextResponse.json({ error: 'Failed to compute stats' }, { status: 500 });
  }
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import AlarmSettings from './alarm-settings';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

// ---------------------------------------------------------------- types

interface Reading {
  capturedAt: string;
  tempC: number; // DHT11 air temperature
  humidity: number; // DHT11 relative humidity
  probeTempC: number | null; // DS18B20 water temperature
}

interface NodeData {
  deviceUid: string;
  label: string;
  site: string;
  lastSeen: string | null; // newest reading ever, even outside the window
  readings: Reading[]; // readings inside the window only
}

interface Forecast {
  id: string;
  targetAt: string;
  tempC: number | null;
}

interface NodeSummary {
  deviceUid: string; label: string; site: string; n: number; lastSeen: string | null;
  airMean: number | null; airMin: number | null; airMax: number | null; airSd: number | null;
  waterMean: number | null; waterMin: number | null; waterMax: number | null; waterSd: number | null;
  rhMean: number | null; waterMinusAir: number | null; airWaterCorr: number | null;
}
interface HourlyRow {
  deviceUid: string; hour: string; n: number;
  airMean: number | null; waterMean: number | null; waterMin: number | null; waterMax: number | null;
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
interface NodeEvent { deviceUid: string; label: string; kind: string; at: string; message: string }
interface Plateau { start: string; end: string | null; minutes: number }
interface TimeConstant { tauMinutes: number; tInfC: number; r2: number; points: number }
interface Stats {
  windowHours: number;
  nodes: NodeSummary[];
  hourly: HourlyRow[];
  sites: SiteRow[];
  pairs: PairRow[];
  events: NodeEvent[];
  plateaus: Record<string, Plateau>;
  timeConstants: Record<string, TimeConstant>;
}

interface AlarmRow {
  id: string; deviceUid: string; label: string; kind: string; message: string;
  value: number | null; rate: number | null; triggeredAt: string; clearedAt: string | null; notified: boolean;
}
interface Alarms { active: AlarmRow[]; recent: AlarmRow[]; pushEnabled: boolean; rulesWatching: number }

// "water_rising" -> "Water rising alarm"
const alarmTitle = (kind: string) => {
  const [channel, condition] = kind.split('_');
  if (!condition) return 'Alarm';
  return `${channel.charAt(0).toUpperCase()}${channel.slice(1)} ${condition} alarm`;
};

type Row = Record<string, number | null> & { t: number };

// ---------------------------------------------------------------- helpers

// One colour per node; water is a solid line, air is dotted in the same colour
const NODE_COLORS = ['#fb923c', '#38bdf8', '#34d399', '#f472b6'];
const FORECAST_COLOR = '#a78bfa';
// The Prophet worker trains on this node's air temperature
const FORECAST_DEVICE = 'dev:351077454469720';

const f1 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(1);
const f2 = (v: number | null | undefined) =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(2);
const toF = (c: number) => (c * 9) / 5 + 32;
const fmtTime = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Heat index (NOAA Rothfusz regression), °C in and out
const heatIndex = (tC: number, rh: number) => {
  const tF = toF(tC);
  if (tF < 80) return tC; // the regression is only valid above 80 °F
  const hiF = -42.379 + 2.04901523 * tF + 10.14333127 * rh
    - 0.22475541 * tF * rh - 0.00683783 * tF * tF - 0.05481717 * rh * rh
    + 0.00122874 * tF * tF * rh + 0.00085282 * tF * rh * rh - 0.00000199 * tF * tF * rh * rh;
  return ((hiF - 32) * 5) / 9;
};

// Dew point (Magnus formula), °C
const dewPoint = (tC: number, rh: number) => {
  const a = 17.27, b = 237.7;
  const alpha = (a * tC) / (b + tC) + Math.log(Math.max(rh, 1) / 100);
  return (b * alpha) / (a - alpha);
};

function lastSeen(iso: string | undefined) {
  if (!iso) return { text: 'no readings yet', color: 'text-slate-500' };
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 120) return { text: `${s}s ago`, color: 'text-green-400' };
  if (s < 3600) return { text: `${Math.floor(s / 60)} min ago`, color: s < 600 ? 'text-amber-400' : 'text-red-400' };
  if (s < 86400) return { text: `${Math.floor(s / 3600)} h ago`, color: 'text-red-400' };
  return { text: `${Math.floor(s / 86400)} days ago`, color: 'text-red-400' };
}

const tooltipStyle = { backgroundColor: '#1e293b', border: 'none', fontSize: 12 };

// Live charts cover this many hours; older readings stay in the database
const LIVE_WINDOW_HOURS = 12;

// ---------------------------------------------------------------- component

export default function Dashboard() {
  const [nodes, setNodes] = useState<NodeData[] | null>(null);
  const [forecasts, setForecasts] = useState<Forecast[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alarms, setAlarms] = useState<Alarms | null>(null);

  useEffect(() => {
    const loadLive = async () => {
      try {
        const [nodesRes, fcRes, alarmRes] = await Promise.all([
          fetch(`/api/nodes?hours=${LIVE_WINDOW_HOURS}&limit=${LIVE_WINDOW_HOURS * 60}`),
          fetch('/api/forecasts'),
          fetch('/api/alarms'),
        ]);
        if (!nodesRes.ok) throw new Error(`HTTP ${nodesRes.status}`);
        setNodes((await nodesRes.json()).nodes);
        if (fcRes.ok) setForecasts((await fcRes.json()).forecasts ?? []);
        if (alarmRes.ok) setAlarms(await alarmRes.json());
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load data');
      }
    };
    const loadStats = async () => {
      try {
        const res = await fetch('/api/stats?hours=24');
        if (res.ok) setStats(await res.json());
      } catch {
        /* the live charts still work without the stats panel */
      }
    };
    loadLive();
    loadStats();
    const live = setInterval(loadLive, 10000);
    const agg = setInterval(loadStats, 60000);
    return () => {
      clearInterval(live);
      clearInterval(agg);
    };
  }, []);

  // One row per minute; each node writes its own columns, e.g. 0_w, 0_a, 1_w
  const { rows, liveRows, tempDomain, hasForecast } = useMemo(() => {
    const byMinute = new Map<number, Row>();
    const get = (t: number) => {
      let r = byMinute.get(t);
      if (!r) {
        r = { t } as Row;
        byMinute.set(t, r);
      }
      return r;
    };
    const temps: number[] = [];
    let forecastFrom = 0;

    (nodes ?? []).forEach((node, i) => {
      for (const r of node.readings) {
        const t = Math.floor(new Date(r.capturedAt).getTime() / 60000) * 60000;
        const row = get(t);
        row[`${i}_a`] = r.tempC;
        row[`${i}_rh`] = r.humidity;
        row[`${i}_hi`] = heatIndex(r.tempC, r.humidity);
        row[`${i}_dp`] = dewPoint(r.tempC, r.humidity);
        temps.push(r.tempC);
        if (r.probeTempC !== null) {
          row[`${i}_w`] = r.probeTempC;
          temps.push(r.probeTempC);
        }
        if (node.deviceUid === FORECAST_DEVICE) forecastFrom = Math.max(forecastFrom, t);
      }
    });

    // Live rows only (no forecast) for the smaller charts
    const live = Array.from(byMinute.values()).sort((a, b) => a.t - b.t);

    // Only forecasts ahead of the forecast node's latest reading, and no further
    // ahead than the live window is long, so the live data keeps at least half
    // of the chart's width
    let fcCount = 0;
    if (forecastFrom > 0) {
      const liveSpan = live.length ? live[live.length - 1].t - live[0].t : 0;
      const horizon = Math.min(Math.max(liveSpan, 3600000), 24 * 3600000);
      for (const f of forecasts) {
        const t = new Date(f.targetAt).getTime();
        if (f.tempC === null || t <= forecastFrom || t > forecastFrom + horizon || f.tempC < -50 || f.tempC > 60) continue;
        get(t).fc = f.tempC;
        temps.push(f.tempC);
        fcCount++;
      }
    }

    const sorted = Array.from(byMinute.values()).sort((a, b) => a.t - b.t);
    const lo = temps.length ? Math.floor(Math.min(...temps) - 1) : 0;
    const hi = temps.length ? Math.ceil(Math.max(...temps) + 1) : 30;
    return { rows: sorted, liveRows: live, tempDomain: [lo, hi] as [number, number], hasForecast: fcCount > 0 };
  }, [nodes, forecasts]);

  // Hourly means per node, for the temporal-aggregation chart
  const hourlyRows = useMemo(() => {
    if (!stats || !nodes) return [];
    const idx = new Map(nodes.map((n, i) => [n.deviceUid, i]));
    const byHour = new Map<number, Row>();
    for (const h of stats.hourly) {
      const i = idx.get(h.deviceUid);
      if (i === undefined) continue;
      const t = new Date(h.hour).getTime();
      const row = byHour.get(t) ?? ({ t } as Row);
      row[`${i}_w`] = h.waterMean;
      row[`${i}_a`] = h.airMean;
      byHour.set(t, row);
    }
    return Array.from(byHour.values()).sort((a, b) => a.t - b.t);
  }, [stats, nodes]);

  if (error && !nodes) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-red-400">Failed to load data ({error})</div>
      </div>
    );
  }
  if (!nodes) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  const labelOf = (uid: string) => nodes.find((n) => n.deviceUid === uid)?.label ?? uid;
  const colorOf = (uid: string) => {
    const i = nodes.findIndex((n) => n.deviceUid === uid);
    return NODE_COLORS[(i < 0 ? 0 : i) % NODE_COLORS.length];
  };
  const forecastNode = nodes.find((n) => n.deviceUid === FORECAST_DEVICE);

  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={['dataMin', 'dataMax']}
      tickFormatter={fmtTime}
      stroke="#64748b"
      fontSize={10}
    />
  );

  const smallChart = (title: string, key: string, unit: string) => (
    <div className="bg-slate-900 rounded-lg p-6">
      <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-1">{title}</h3>
      <div className="flex flex-wrap gap-x-4 text-sm mb-3">
        {nodes.map((n, i) => {
          const r = n.readings[n.readings.length - 1];
          const v = !r ? null
            : key === 'rh' ? r.humidity
            : key === 'hi' ? heatIndex(r.tempC, r.humidity)
            : dewPoint(r.tempC, r.humidity);
          return (
            <span key={n.deviceUid} style={{ color: NODE_COLORS[i % NODE_COLORS.length] }}>
              {n.label}: <b>{f1(v)}{unit}</b>
            </span>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <LineChart data={liveRows}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          {xAxis}
          <YAxis stroke="#64748b" fontSize={10} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v: number) => v.toFixed(1)} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtTime(Number(t))} formatter={(v) => f1(Number(v))} />
          {nodes.map((n, i) => (
            <Line key={n.deviceUid} dataKey={`${i}_${key}`} name={n.label} type="monotone"
              stroke={NODE_COLORS[i % NODE_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">bayes-iot</h1>
        <p className="text-slate-400">
          Distributed IoT sensing · {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'} · aggregation and Bayesian forecasting
        </p>
        <a href="https://github.com/jaycoed365/bayes-iot-pipeline" target="_blank" rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm">
          github.com/jaycoed365/bayes-iot-pipeline →
        </a>
      </div>

      {/* Alarms */}
      {alarms && alarms.active.length > 0 && (
        <div className="mb-6 space-y-3">
          {alarms.active.map((a) => (
            <div key={a.id} className="rounded-lg border-2 border-red-500 bg-red-950/60 p-4 animate-pulse">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-lg font-bold text-red-300">
                  {alarmTitle(a.kind)} · {a.label}
                </span>
                <span className="text-sm text-red-200">
                  since {fmtDateTime(a.triggeredAt)}{a.notified ? ' · phone notified' : ''}
                </span>
              </div>
              <p className="text-red-100 mt-1">{a.message}</p>
            </div>
          ))}
        </div>
      )}
      {alarms && alarms.active.length === 0 && (
        <div className="mb-6 rounded-lg border border-emerald-700 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-200">
          No active alarms · {alarms.rulesWatching} {alarms.rulesWatching === 1 ? 'rule' : 'rules'} watching.
          {alarms.recent.length > 0 && (
            <span className="text-emerald-400">
              {' '}Last alarm: {alarms.recent[0].label}, {fmtDateTime(alarms.recent[0].triggeredAt)}
              {alarms.recent[0].clearedAt ? `, cleared ${fmtDateTime(alarms.recent[0].clearedAt)}` : ''}.
            </span>
          )}
        </div>
      )}

      <AlarmSettings />

      {/* Node cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        {nodes.map((n, i) => {
          const r = n.readings[n.readings.length - 1];
          const seen = lastSeen(n.lastSeen ?? r?.capturedAt);
          const color = NODE_COLORS[i % NODE_COLORS.length];
          return (
            <div key={n.deviceUid} className="bg-slate-900 rounded-lg p-6" style={{ borderTop: `4px solid ${color}` }}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-xl font-semibold" style={{ color }}>{n.label}</h2>
                <span className={`text-sm ${seen.color}`}>last reading {seen.text}</span>
              </div>
              <p className="text-xs text-slate-500 mb-4">{n.site} · {n.deviceUid}</p>
              {!r && (
                <p className="text-sm text-amber-400 mb-3">No readings in the last {LIVE_WINDOW_HOURS} hours</p>
              )}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xs text-slate-400 uppercase">Water</div>
                  <div className="text-3xl font-bold" style={{ color }}>{f1(r?.probeTempC)}°C</div>
                  <div className="text-xs text-slate-500">{r?.probeTempC != null ? `${f1(toF(r.probeTempC))}°F` : 'probe not reporting'}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase">Air</div>
                  <div className="text-3xl font-bold text-slate-200">{f1(r?.tempC)}°C</div>
                  <div className="text-xs text-slate-500">{r ? `${f1(toF(r.tempC))}°F` : ''}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400 uppercase">Humidity</div>
                  <div className="text-3xl font-bold text-slate-200">{f1(r?.humidity)}%</div>
                </div>
              </div>
            </div>
          );
        })}
        {nodes.length === 0 && (
          <div className="bg-slate-900 rounded-lg p-6 text-slate-400">No nodes registered yet.</div>
        )}
      </div>

      {/* All temperature channels on one chart */}
      <div className="bg-slate-900 rounded-lg p-6 mb-6">
        <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-1">Temperature · every channel</h3>
        <p className="text-xs text-slate-500 mb-4">
          Solid: water (DS18B20) · dotted: air (DHT11)
          {hasForecast && forecastNode ? ` · dashed purple: Prophet forecast of ${forecastNode.label} air` : ''}
        </p>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
            {xAxis}
            <YAxis stroke="#64748b" fontSize={10} domain={tempDomain} tickFormatter={(v: number) => v.toFixed(1)} />
            <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtTime(Number(t))} formatter={(v) => `${f1(Number(v))} °C`} />
            <Legend wrapperStyle={{ fontSize: '11px' }} iconSize={10} />
            {nodes.flatMap((n, i) => [
              <Line key={`${n.deviceUid}-w`} dataKey={`${i}_w`} name={`${n.label} water`} type="monotone"
                stroke={NODE_COLORS[i % NODE_COLORS.length]} strokeWidth={2.5} dot={false} connectNulls />,
              <Line key={`${n.deviceUid}-a`} dataKey={`${i}_a`} name={`${n.label} air`} type="monotone"
                stroke={NODE_COLORS[i % NODE_COLORS.length]} strokeWidth={1.5} strokeDasharray="2 4" dot={false} connectNulls />,
            ])}
            {hasForecast && (
              <Line dataKey="fc" name="Forecast" type="monotone" stroke={FORECAST_COLOR}
                strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Derived and humidity channels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
        {smallChart('Humidity', 'rh', '%')}
        {smallChart('Heat index', 'hi', '°C')}
        {smallChart('Dew point', 'dp', '°C')}
      </div>

      {/* ------------------------------------------------ aggregation */}
      <h2 className="text-2xl font-bold mb-1">Aggregation</h2>
      <p className="text-slate-400 text-sm mb-6">
        Computed in Postgres over the last {stats?.windowHours ?? 24} hours · refreshes every minute
      </p>

      {!stats ? (
        <div className="text-slate-500 mb-10">Loading statistics...</div>
      ) : (
        <>
          {/* Per-node summary */}
          <div className="bg-slate-900 rounded-lg p-6 mb-6 overflow-x-auto">
            <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Per node · summary statistics</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-slate-400 text-left border-b border-slate-700">
                  <th className="py-2 pr-4">Node</th>
                  <th className="py-2 pr-4 text-right">Readings</th>
                  <th className="py-2 pr-4 text-right">Water mean</th>
                  <th className="py-2 pr-4 text-right">Water min / max</th>
                  <th className="py-2 pr-4 text-right">Water σ</th>
                  <th className="py-2 pr-4 text-right">Air mean</th>
                  <th className="py-2 pr-4 text-right">Air min / max</th>
                  <th className="py-2 pr-4 text-right">Water − air</th>
                  <th className="py-2 text-right">Corr(water, air)</th>
                </tr>
              </thead>
              <tbody>
                {stats.nodes.map((s) => (
                  <tr key={s.deviceUid} className="border-b border-slate-800">
                    <td className="py-2 pr-4 font-semibold" style={{ color: colorOf(s.deviceUid) }}>{s.label}</td>
                    <td className="py-2 pr-4 text-right">{s.n}</td>
                    <td className="py-2 pr-4 text-right">{f1(s.waterMean)} °C</td>
                    <td className="py-2 pr-4 text-right">{f1(s.waterMin)} / {f1(s.waterMax)}</td>
                    <td className="py-2 pr-4 text-right">{f2(s.waterSd)}</td>
                    <td className="py-2 pr-4 text-right">{f1(s.airMean)} °C</td>
                    <td className="py-2 pr-4 text-right">{f1(s.airMin)} / {f1(s.airMax)}</td>
                    <td className="py-2 pr-4 text-right">{f1(s.waterMinusAir)} °C</td>
                    <td className="py-2 text-right">{f2(s.airWaterCorr)}</td>
                  </tr>
                ))}
                {stats.nodes.length === 0 && (
                  <tr><td colSpan={9} className="py-3 text-slate-500">No readings in this window yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Hierarchical rollup */}
            <div className="bg-slate-900 rounded-lg p-6">
              <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Site rollup · node → site</h3>
              {stats.sites.map((s) => (
                <div key={s.site} className="mb-3">
                  <div className="text-lg font-semibold">{s.site}</div>
                  <div className="text-sm text-slate-400">{s.nodes} nodes · {s.n} readings</div>
                  <div className="text-sm mt-1">
                    Water mean <b>{f1(s.waterMean)} °C</b> (range {f1(s.waterMin)} to {f1(s.waterMax)}) · air mean <b>{f1(s.airMean)} °C</b>
                  </div>
                </div>
              ))}
              {stats.sites.length === 0 && <div className="text-slate-500 text-sm">No data yet.</div>}
            </div>

            {/* Cross-sensor comparison */}
            <div className="bg-slate-900 rounded-lg p-6">
              <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Cross-node comparison</h3>
              {stats.pairs.map((p) => (
                <div key={`${p.aUid}-${p.bUid}`} className="text-sm space-y-1 mb-3">
                  <div className="font-semibold">
                    <span style={{ color: colorOf(p.aUid) }}>{labelOf(p.aUid)}</span> vs{' '}
                    <span style={{ color: colorOf(p.bUid) }}>{labelOf(p.bUid)}</span>
                  </div>
                  <div>Water difference: <b>{f1(p.waterDiffMean)} ± {f1(p.waterDiffSd)} °C</b></div>
                  <div>Water correlation: <b>{f2(p.waterCorr)}</b></div>
                  <div>Air difference: <b>{f1(p.airDiffMean)} °C</b> · air correlation <b>{f2(p.airCorr)}</b></div>
                  <div className="text-xs text-slate-500">{p.n} matched minutes</div>
                </div>
              ))}
              {stats.pairs.length === 0 && (
                <div className="text-slate-500 text-sm">Needs two nodes reporting in the same minutes.</div>
              )}
            </div>

            {/* Events */}
            <div className="bg-slate-900 rounded-lg p-6">
              <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Events</h3>
              <ul className="space-y-2 text-sm">
                {stats.events.map((e, k) => (
                  <li key={k} className="flex gap-3">
                    <span className="text-slate-500 whitespace-nowrap">{fmtDateTime(e.at)}</span>
                    <span className={e.kind === 'node_silent' ? 'text-red-400' : ''}>{e.message}</span>
                  </li>
                ))}
                {stats.events.length === 0 && <li className="text-slate-500">No events in this window.</li>}
              </ul>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-10">
            {/* Temporal aggregation */}
            <div className="bg-slate-900 rounded-lg p-6 lg:col-span-2">
              <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Hourly means</h3>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={hourlyRows}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                  {xAxis}
                  <YAxis stroke="#64748b" fontSize={10} domain={['dataMin - 1', 'dataMax + 1']} tickFormatter={(v: number) => v.toFixed(1)} />
                  <Tooltip contentStyle={tooltipStyle} labelFormatter={(t) => fmtTime(Number(t))} formatter={(v) => `${f1(Number(v))} °C`} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} iconSize={10} />
                  {nodes.flatMap((n, i) => [
                    <Line key={`${n.deviceUid}-hw`} dataKey={`${i}_w`} name={`${n.label} water`}
                      stroke={NODE_COLORS[i % NODE_COLORS.length]} strokeWidth={2} dot connectNulls />,
                    <Line key={`${n.deviceUid}-ha`} dataKey={`${i}_a`} name={`${n.label} air`}
                      stroke={NODE_COLORS[i % NODE_COLORS.length]} strokeWidth={1.5} strokeDasharray="2 4" dot={false} connectNulls />,
                  ])}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Physics: melting plateau and warming time constant */}
            <div className="bg-slate-900 rounded-lg p-6">
              <h3 className="text-sm text-slate-400 uppercase tracking-wide mb-4">Melting and warming</h3>
              {Object.keys(stats.plateaus).length === 0 && Object.keys(stats.timeConstants).length === 0 && (
                <p className="text-sm text-slate-500">
                  Appears once a cup sits at the 0 °C melting plateau (about 5 minutes between −1 and +1 °C).
                </p>
              )}
              {Object.entries(stats.plateaus).map(([uid, p]) => (
                <div key={uid} className="text-sm mb-3">
                  <div className="font-semibold" style={{ color: colorOf(uid) }}>{labelOf(uid)}</div>
                  <div>
                    0 °C plateau: <b>{p.minutes} min</b> {p.end ? '(all ice melted)' : '(still melting)'}
                  </div>
                </div>
              ))}
              {Object.entries(stats.timeConstants).map(([uid, tc]) => (
                <div key={uid} className="text-sm mb-3">
                  <div>
                    Warming time constant τ = <b>{f1(tc.tauMinutes)} min</b>
                  </div>
                  <div className="text-xs text-slate-500">
                    Fit of T(t) = T∞ − (T∞ − T₀)·e^(−t/τ), T∞ = {f1(tc.tInfC)} °C, R² = {f2(tc.r2)}, {tc.points} points
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-slate-500">
        auto-refresh every 10s · data from Neon Postgres · built with Next.js + Prisma + Recharts + Prophet
      </div>
    </div>
  );
}

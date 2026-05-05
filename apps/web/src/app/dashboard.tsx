"use client";

import { useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { formatDistanceToNowStrict } from "date-fns";

type Reading = {
  id: string;
  deviceUid: string;
  capturedAt: string;
  tempC: number;
  humidity: number;
  pressureHpa: number | null;
  vocOhms: number | null;
};

type ApiResponse = {
  count: number;
  readings: Reading[];
  generatedAt: string;
};

const REFRESH_MS = 10_000;

const charts = [
  { key: "tempC",       label: "Temperature",  unit: "°C",  color: "#f97316", fixed: 1 },
  { key: "humidity",    label: "Humidity",     unit: "%",   color: "#3b82f6", fixed: 1 },
  { key: "pressureHpa", label: "Pressure",     unit: "hPa", color: "#a855f7", fixed: 1 },
  { key: "vocOhms",     label: "VOC gas",      unit: "Ω",   color: "#10b981", fixed: 0 },
] as const;

export function Dashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Fetch loop
  useEffect(() => {
    let alive = true;

    async function fetchData() {
      try {
        const res = await fetch("/api/readings?limit=50", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json: ApiResponse = await res.json();
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : "fetch failed");
      }
    }

    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Re-render every second so "last seen" stays accurate
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  if (error) {
    return (
      <div className="rounded-lg border border-red-900/50 bg-red-950/30 p-6 text-red-300">
        <div className="font-semibold">Failed to load data</div>
        <div className="mt-1 font-mono text-sm">{error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900 p-6 text-zinc-400">
        Loading…
      </div>
    );
  }

  if (data.readings.length === 0) {
    return (
      <div className="rounded-lg border border-ink-700 bg-ink-900 p-6">
        <div className="font-semibold text-zinc-200">No readings yet</div>
        <div className="mt-2 text-sm text-zinc-400">
          Start the simulator with <code className="rounded bg-ink-800 px-1.5 py-0.5 font-mono text-xs">pnpm simulate</code> to see data flow in.
        </div>
      </div>
    );
  }

  const latest = data.readings[data.readings.length - 1];
  const ageMs = Date.now() - new Date(latest.capturedAt).getTime();
  const ageColor =
    ageMs < 60_000 ? "text-emerald-400" :
    ageMs < 5 * 60_000 ? "text-amber-400" :
    "text-red-400";

  // Voiding "tick" usage - referenced to keep eslint quiet
  void tick;

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 bg-ink-900 p-4">
        <div className="flex items-center gap-3">
          <span className={`h-2.5 w-2.5 rounded-full ${ageMs < 60_000 ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
          <span className="text-sm text-zinc-400">
            {data.readings.length} readings · device <span className="font-mono text-zinc-300">{latest.deviceUid}</span>
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-zinc-500">last reading</span>
          <span className={`font-mono ${ageColor}`}>
            {formatDistanceToNowStrict(new Date(latest.capturedAt), { addSuffix: true })}
          </span>
        </div>
      </div>

      {/* Charts grid */}
      <div className="grid gap-4 md:grid-cols-2">
        {charts.map((c) => {
          const series = data.readings.map((r) => ({
            t: new Date(r.capturedAt).getTime(),
            v: (r as Reading)[c.key as keyof Reading] as number | null,
          }));
          const values = series.map((s) => s.v).filter((v): v is number => v != null);
          const current = values.length ? values[values.length - 1] : null;
          const min = values.length ? Math.min(...values) : null;
          const max = values.length ? Math.max(...values) : null;

          return (
            <div key={c.key} className="rounded-lg border border-ink-700 bg-ink-900 p-4">
              <div className="mb-3 flex items-baseline justify-between">
                <div>
                  <div className="text-sm uppercase tracking-wider text-zinc-500">{c.label}</div>
                  <div className="mt-1 font-mono text-3xl" style={{ color: c.color }}>
                    {current != null ? current.toFixed(c.fixed) : "—"}
                    <span className="ml-1 text-sm text-zinc-500">{c.unit}</span>
                  </div>
                </div>
                <div className="text-right text-xs text-zinc-500">
                  <div>min {min != null ? min.toFixed(c.fixed) : "—"}</div>
                  <div>max {max != null ? max.toFixed(c.fixed) : "—"}</div>
                </div>
              </div>
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={series} margin={{ top: 5, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="#262934" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="t"
                      type="number"
                      domain={["dataMin", "dataMax"]}
                      tickFormatter={(t) => {
                        const d = new Date(t);
                        return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
                      }}
                      stroke="#3a3e4d"
                      fontSize={11}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="#3a3e4d"
                      fontSize={11}
                      tickLine={false}
                      width={40}
                      domain={["dataMin - 1", "dataMax + 1"]}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "#11121a",
                        border: "1px solid #262934",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                      labelFormatter={(t) => new Date(t as number).toLocaleString()}
                      formatter={(value: number) => [`${value.toFixed(c.fixed)} ${c.unit}`, c.label]}
                    />
                    <Line
                      type="monotone"
                      dataKey="v"
                      stroke={c.color}
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

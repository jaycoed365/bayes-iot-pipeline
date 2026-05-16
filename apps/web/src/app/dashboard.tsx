'use client';

import { useEffect, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  ComposedChart,
  Legend,
} from 'recharts';

interface Reading {
  id: string;
  deviceUid: string;
  tempC: number;
  humidity: number;
  pressureHpa: number | null;
  vocOhms: number | null;
  capturedAt: string;
}

interface Forecast {
  id: string;
  targetAt: string;
  tempC: number | null;
  tempCLower: number | null;
  tempCUpper: number | null;
}

interface ChartPoint {
  time: string;
  timestamp: number;
  actual: number | null;
  forecast: number | null;
  lower: number | null;
  upper: number | null;
}

interface ApiResponse {
  readings: Reading[];
  totalCount: number;
  returnedCount: number;
}

interface ForecastResponse {
  forecasts: Forecast[];
  forecastedAt: string | null;
  count: number;
}

export default function Dashboard() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [forecasts, setForecasts] = useState<ForecastResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    try {
      const [readingsRes, forecastsRes] = await Promise.all([
        fetch('/api/readings?limit=50'),
        fetch('/api/forecasts')
      ]);

      if (!readingsRes.ok) throw new Error(`HTTP ${readingsRes.status}`);

      const readingsJson = await readingsRes.json();
      setData(readingsJson);

      if (forecastsRes.ok) {
        const forecastsJson = await forecastsRes.json();
        setForecasts(forecastsJson);
      }

      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-red-400">Failed to load data<br />HTTP {error}</div>
      </div>
    );
  }

  if (!data || data.readings.length === 0) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-slate-400">No data available</div>
      </div>
    );
  }

  const readings = data.readings.reverse();
  console.log('Readings:', readings.length, 'readings');
  console.log('Latest:', readings[readings.length - 1]);
  const latest = readings[readings.length - 1];
  const lastSeenMs = new Date().getTime() - new Date(latest.capturedAt).getTime();
  const lastSeenSeconds = Math.floor(lastSeenMs / 1000);

  let lastSeenText = '';
  let lastSeenColor = 'text-green-400';

  if (lastSeenSeconds < 60) {
    lastSeenText = `${lastSeenSeconds} seconds ago`;
  } else if (lastSeenSeconds < 3600) {
    const mins = Math.floor(lastSeenSeconds / 60);
    lastSeenText = `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`;
    lastSeenColor = lastSeenSeconds < 300 ? 'text-amber-400' : 'text-red-400';
  } else {
    const hours = Math.floor(lastSeenSeconds / 3600);
    lastSeenText = `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    lastSeenColor = 'text-red-400';
  }

  // Prepare temperature data with forecasts
  const tempData: ChartPoint[] = readings.map((r) => ({
    time: new Date(r.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    timestamp: new Date(r.capturedAt).getTime(),
    actual: r.tempC,
    forecast: null,
    lower: null,
    upper: null,
  }));

  // Add forecast data
  if (forecasts && forecasts.forecasts.length > 0) {
    forecasts.forecasts.forEach((f) => {
      tempData.push({
        time: new Date(f.targetAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: new Date(f.targetAt).getTime(),
        actual: null,
        forecast: f.tempC,
        lower: f.tempCLower,
        upper: f.tempCUpper,
      });
    });
  }

  // Sort by timestamp
  tempData.sort((a, b) => a.timestamp - b.timestamp);

  const humData = readings.map((r) => ({
    time: new Date(r.capturedAt).toLocaleTimeString(),
    value: r.humidity,
  }));

  const pressData = readings.map((r) => ({
    time: new Date(r.capturedAt).toLocaleTimeString(),
    value: r.pressureHpa,
  }));

  const vocData = readings.map((r) => ({
    time: new Date(r.capturedAt).toLocaleTimeString(),
    value: r.vocOhms,
  }));

  const tempMin = Math.min(...readings.map((r) => r.tempC));
  const tempMax = Math.max(...readings.map((r) => r.tempC));
  const humMin = Math.min(...readings.map((r) => r.humidity));
  const humMax = Math.max(...readings.map((r) => r.humidity));
  const pressMin = Math.min(...readings.map((r) => r.pressureHpa ?? 0));
  const pressMax = Math.max(...readings.map((r) => r.pressureHpa ?? 0));
  const vocMin = Math.min(...readings.map((r) => r.vocOhms ?? 0));
  const vocMax = Math.max(...readings.map((r) => r.vocOhms ?? 0));
  const chartTempMin = Math.min(...readings.map((r) => r.tempC)) - 1;
  const chartTempMax = Math.max(...readings.map((r) => r.tempC)) + 1;

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">bayes-iot</h1>
        <p className="text-slate-400">Real-time IoT pipeline · Bayesian time-series forecasting</p>
        <a
          href="https://github.com/jaycoed365/bayes-iot-pipeline"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-400 hover:text-blue-300 text-sm"
        >
          github.com/jaycoed365/bayes-iot-pipeline →
        </a>
      </div>

      {/* Status Bar */}
      <div className="mb-6 flex items-center gap-6 text-sm">
        <div className="text-slate-300">
          <span className="text-slate-500">●</span> {data.totalCount} readings · device {latest.deviceUid}
        </div>
        <div className={`${lastSeenColor}`}>
          last reading {lastSeenText}
        </div>
        {forecasts && forecasts.count > 0 && (
          <div className="text-blue-400">
            {forecasts.count} forecasts · Prophet baseline
          </div>
        )}
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Temperature with Forecast */}
        <div className="bg-slate-900 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-sm text-slate-400 uppercase tracking-wide">Temperature + Forecast</h3>
            <div className="text-3xl font-bold text-orange-400">
              {latest.tempC.toFixed(1)}°C
              <span className="text-xl text-slate-500 ml-2">
                ({(latest.tempC * 9 / 5 + 32).toFixed(1)}°F)
              </span>
            </div>
            <div className="text-xs text-slate-500 mt-1">
              min {tempMin.toFixed(1)}°C ({(tempMin * 9 / 5 + 32).toFixed(1)}°F) ·
              max {tempMax.toFixed(1)}°C ({(tempMax * 9 / 5 + 32).toFixed(1)}°F)
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={tempData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="time"
                stroke="#64748b"
                fontSize={10}
                interval="preserveStartEnd"
                tick={{ fontSize: 9 }}
              />
              <YAxis stroke="#64748b" fontSize={10} domain={[chartTempMin, chartTempMax]} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px' }}
                iconSize={10}
              />
              {/* Confidence interval area */}
              <Area
                type="monotone"
                dataKey="upper"
                stroke="none"
                fill="#3b82f6"
                fillOpacity={0.15}
                name="95% CI"
              />
              <Area
                type="monotone"
                dataKey="lower"
                stroke="none"
                fill="#3b82f6"
                fillOpacity={0.15}
              />
              {/* Actual temperature line */}
              <Line
                type="monotone"
                dataKey="actual"
                stroke="#fb923c"
                strokeWidth={2}
                dot={false}
                name="Actual"
                connectNulls={false}
              />
              {/* Forecast line */}
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="#3b82f6"
                strokeWidth={2}
                strokeDasharray="5 5"
                dot={false}
                name="Forecast"
                connectNulls
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Humidity */}
        <div className="bg-slate-900 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-sm text-slate-400 uppercase tracking-wide">Humidity</h3>
            <div className="text-3xl font-bold text-blue-400">
              {latest.humidity.toFixed(1)}%
            </div>
            <div className="text-xs text-slate-500 mt-1">
              min {humMin.toFixed(1)} · max {humMax.toFixed(1)}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={humData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} domain={['dataMin - 2', 'dataMax + 2']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line type="monotone" dataKey="value" stroke="#60a5fa" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Pressure */}
        <div className="bg-slate-900 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-sm text-slate-400 uppercase tracking-wide">Pressure</h3>
            <div className="text-3xl font-bold text-purple-400">
              {latest.pressureHpa?.toFixed(1) ?? 'N/A'} hPa
            </div>
            <div className="text-xs text-slate-500 mt-1">
              min {pressMin.toFixed(1)} · max {pressMax.toFixed(1)}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pressData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} domain={['dataMin - 0.5', 'dataMax + 0.5']} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line type="monotone" dataKey="value" stroke="#c084fc" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* VOC Gas */}
        <div className="bg-slate-900 rounded-lg p-6">
          <div className="mb-4">
            <h3 className="text-sm text-slate-400 uppercase tracking-wide">VOC Gas</h3>
            <div className="text-3xl font-bold text-green-400">
              {latest.vocOhms?.toFixed(0) ?? 'N/A'} Ω
            </div>
            <div className="text-xs text-slate-500 mt-1">
              min {vocMin.toFixed(0)} · max {vocMax.toFixed(0)}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={vocData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="time" stroke="#64748b" fontSize={10} />
              <YAxis stroke="#64748b" fontSize={10} />
              <Tooltip
                contentStyle={{ backgroundColor: '#1e293b', border: 'none' }}
                labelStyle={{ color: '#94a3b8' }}
              />
              <Line type="monotone" dataKey="value" stroke="#4ade80" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Footer */}
      <div className="mt-8 text-center text-xs text-slate-500">
        auto-refresh every 10s · data from Neon Postgres · built with Next.js + Prisma + Recharts + Prophet
      </div>
    </div>
  );
}

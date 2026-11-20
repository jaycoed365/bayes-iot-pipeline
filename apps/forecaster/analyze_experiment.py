"""
Frozen vs refrigerated water: analysis of the two-node experiment.

Six data streams (two nodes x water / air / humidity) are pulled from Neon
(or a CSV export) and analysed with five techniques:

  1. Temporal aggregation      1-, 5- and 15-minute windows: mean, variance, std,
                               and how averaging lowers noise (sigma / sqrt(N))
  2. Cross-node difference     dT(t) = T_ice(t) - T_fridge(t), water and air
  3. Numerical differentiation dT/dt, plus Newton's-law check dT/dt = (T_inf - T)/tau
  4. Cross-correlation         normalised, with lags, on first differences
  5. Forecast evaluation       Prophet (the production model) vs a persistence
                               baseline, rolling-origin backtest: MAE, RMSE and
                               coverage of the 95 % interval

Physics on top: melting-plateau length, warming time constant tau (two
independent methods), and the latent-heat prediction t_melt = tau * L_f / (c_w * T_inf).

Usage (from apps/forecaster, with DATABASE_URL in .env):
    python analyze_experiment.py --hours 48
    python analyze_experiment.py --since 2026-11-18T19:00 --until 2026-11-20T19:00
    python analyze_experiment.py --csv results/<run>/raw_readings.csv   # re-run offline

Outputs go to results/<timestamp>/: raw_readings.csv, resampled_*.csv,
summary.md, metrics.json and figures/*.png.
"""

import argparse
import json
import math
import os
from datetime import datetime

import numpy as np
import pandas as pd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

# ------------------------------------------------------------------ constants

L_F = 334.0  # latent heat of fusion of water, J/g
C_W = 4.186  # specific heat of liquid water, J/(g*degC)
PLATEAU_BAND = (-1.0, 1.0)  # DS18B20 is +-0.5 degC, so a slightly wider band
PLATEAU_MIN_MINUTES = 5
PLATEAU_EXIT_C = 1.5
WINDOWS_MIN = [1, 5, 15]
NODE_COLORS = ["#d9480f", "#1971c2", "#2b8a3e", "#c2255c"]
SEP = " · "  # stream names look like "Ice cup · water"


# ------------------------------------------------------------------ loading

def load_from_db(since, until):
    import psycopg2
    from dotenv import load_dotenv

    load_dotenv()
    conn = psycopg2.connect(os.getenv("DATABASE_URL"))
    query = """
        SELECT r."deviceUid" AS device_uid, d.label, r."capturedAt" AS captured_at,
               r."tempC" AS air_c, r.humidity AS rh_pct, r."probeTempC" AS water_c
        FROM "EnvReading" r
        JOIN "Device" d ON d."deviceUid" = r."deviceUid"
        WHERE r."capturedAt" >= %(since)s AND r."capturedAt" < %(until)s
        ORDER BY r."capturedAt"
    """
    df = pd.read_sql(query, conn, params={"since": since, "until": until})
    conn.close()
    return df


def load_from_csv(path):
    return pd.read_csv(path)


def tidy(raw):
    df = raw.copy()
    df["captured_at"] = pd.to_datetime(df["captured_at"], utc=True)
    df = df.dropna(subset=["captured_at"]).sort_values("captured_at")
    return df


def node_order(df):
    """Nodes ordered so the ice cup (lowest minimum water temperature) comes first."""
    mins = df.groupby("label")["water_c"].min().sort_values()
    return list(mins.index)


def wide_frame(df, minutes):
    """One column per stream, resampled to `minutes`-minute means."""
    frames = []
    for label, g in df.groupby("label"):
        s = (g.set_index("captured_at")[["water_c", "air_c", "rh_pct"]]
             .resample(f"{minutes}min").mean())
        s.columns = [f"{label}{SEP}water", f"{label}{SEP}air", f"{label}{SEP}RH"]
        frames.append(s)
    return pd.concat(frames, axis=1).sort_index()


# ------------------------------------------------------------------ 1. temporal aggregation

def temporal_aggregation(df, labels):
    """Window statistics and the noise-vs-window-size check.

    For each window W the within-bucket standard deviation estimates sensor
    noise; averaging N samples should cut it to sigma / sqrt(N)."""
    rows = []
    for label in labels:
        g = df[df.label == label].set_index("captured_at")
        for col, name in [("water_c", "water"), ("air_c", "air"), ("rh_pct", "RH")]:
            x = g[col].dropna()
            if x.empty:
                continue
            for w in WINDOWS_MIN:
                b = x.resample(f"{w}min")
                means = b.mean().dropna()
                within_sd = b.std().dropna()
                counts = b.count()
                rows.append({
                    "node": label, "stream": name, "window_min": w,
                    "buckets": int(means.size),
                    "mean": float(means.mean()),
                    "variance": float(means.var()) if means.size > 1 else float("nan"),
                    "std": float(means.std()) if means.size > 1 else float("nan"),
                    "min": float(means.min()), "max": float(means.max()),
                    "samples_per_bucket": float(counts[counts > 0].mean()),
                    "within_bucket_sd": float(within_sd.mean()) if within_sd.size else float("nan"),
                })
    return pd.DataFrame(rows)


def detrended_noise(df, labels):
    """Sensor noise from first differences of the raw series: for white noise
    on a slow signal, std(diff) = sqrt(2) * sigma."""
    out = {}
    for label in labels:
        g = df[df.label == label].set_index("captured_at")
        for col, name in [("water_c", "water"), ("air_c", "air")]:
            x = g[col].dropna()
            if len(x) > 10:
                out[f"{label}{SEP}{name}"] = float(x.diff().dropna().std() / math.sqrt(2))
    return out


# ------------------------------------------------------------------ physics: plateau and tau

def find_plateau(water):
    """Melting plateau on a 1-minute water series: >= 5 min inside the band,
    ends when the water first rises above PLATEAU_EXIT_C."""
    lo, hi = PLATEAU_BAND
    in_band = (water >= lo) & (water <= hi)
    run, start = 0, None
    for t, flag in in_band.items():
        if flag:
            if run == 0:
                run_start = t
            run += 1
            if run >= PLATEAU_MIN_MINUTES:
                start = run_start
                break
        else:
            run = 0
    if start is None:
        return None
    after = water[water.index >= start]
    above = after[after > PLATEAU_EXIT_C]
    end = above.index[0] if not above.empty else None
    stop = end if end is not None else water.index[-1]
    return {
        "start": start, "end": end,
        "minutes": (stop - start).total_seconds() / 60.0,
        "complete": end is not None,
    }


def fit_tau_log(t_min, temp, t_inf):
    """Method A: ln(T_inf - T) = ln(T_inf - T0) - t / tau  (linear regression).

    Only the early part of the curve is used: once the gap T_inf - T falls to
    a few tenths of a degree it is mostly sensor noise and air drift, and the
    logarithm amplifies that noise. The fit stops the first time the gap drops
    below 15 % of its starting value (about 1.9 tau into the warming)."""
    gap = t_inf - temp
    if gap.size == 0 or gap[0] <= 1.0:
        return None
    below = np.nonzero(gap < max(1.0, 0.15 * gap[0]))[0]
    stop = below[0] if below.size else gap.size
    mask = np.zeros(gap.size, dtype=bool)
    mask[:stop] = gap[:stop] > 0
    if mask.sum() < 10:
        return None
    x, y = t_min[mask], np.log(gap[mask])
    slope, intercept = np.polyfit(x, y, 1)
    if slope >= 0:
        return None
    pred = slope * x + intercept
    r2 = 1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2)
    return {"tau_min": float(-1 / slope), "r2": float(r2), "points": int(mask.sum()), "stop_index": int(stop)}


def fit_tau_derivative(temp_5min, air_5min):
    """Method B: Newton's law says dT/dt = (T_air - T) / tau, so a straight
    line through the origin of dT/dt against (T_air - T) has slope 1/tau."""
    dTdt = np.gradient(temp_5min.values, 5.0)  # degC per minute
    drive = (air_5min - temp_5min).values
    mask = np.isfinite(dTdt) & np.isfinite(drive) & (drive > 0.5)
    if mask.sum() < 10:
        return None
    x, y = drive[mask], dTdt[mask]
    k = float(np.sum(x * y) / np.sum(x * x))  # least squares through the origin
    if k <= 0:
        return None
    pred = k * x
    r2 = 1 - np.sum((y - pred) ** 2) / np.sum((y - y.mean()) ** 2)
    return {"tau_min": 1.0 / k, "r2": float(r2), "points": int(mask.sum()), "x": x, "y": y, "k": k}


def warming_segment(w1, plateau):
    """The liquid-water warming phase: after the plateau ends (ice cup), or the
    whole series (refrigerated cup)."""
    if plateau is not None:
        if plateau["end"] is None:
            return None
        return w1[w1.index >= plateau["end"]]
    return w1


# ------------------------------------------------------------------ 4. cross-correlation

def cross_correlation(x, y, max_lag):
    """Normalised cross-correlation r(k) = corr(x[t], y[t + k]) for k in
    [-max_lag, max_lag]. Positive k: y lags x."""
    lags, vals = [], []
    for k in range(-max_lag, max_lag + 1):
        if k >= 0:
            a, b = x[: len(x) - k], y[k:]
        else:
            a, b = x[-k:], y[: len(y) + k]
        m = np.isfinite(a) & np.isfinite(b)
        if m.sum() < 10 or np.std(a[m]) == 0 or np.std(b[m]) == 0:
            vals.append(np.nan)
        else:
            vals.append(float(np.corrcoef(a[m], b[m])[0, 1]))
        lags.append(k)
    return np.array(lags), np.array(vals)


# ------------------------------------------------------------------ 5. forecast backtest

def newton_forecast(train_water, train_air, horizon_steps, step_min):
    """Physics forecast: T(t+h) = T_air + (T_now - T_air) * exp(-h / tau), with
    tau estimated from the training data only (derivative method). While the
    water sits on the melting plateau it is held at 0 degC: the model cannot
    know when the last of the ice will go."""
    w = train_water.dropna()
    a = train_air.reindex(w.index).interpolate(limit_direction="both")
    if len(w) < 12 or a.isna().all():
        return None
    lo, hi = PLATEAU_BAND
    liquid = ~((w >= lo) & (w <= hi))
    fit = fit_tau_derivative(w[liquid], a[liquid]) if liquid.sum() >= 12 else None
    if fit is None:
        return None
    tau = fit["tau_min"]
    t_now, air_now = float(w.iloc[-1]), float(a.iloc[-12:].mean())
    h = np.arange(1, horizon_steps + 1) * step_min
    if lo <= t_now <= hi:
        return np.zeros(horizon_steps)
    return air_now + (t_now - air_now) * np.exp(-h / tau)


def prophet_backtest(series, horizon_steps, origins, step_min, air=None):
    """Rolling-origin evaluation: fit on data up to each origin, forecast the
    next horizon, score against what was then observed. Compared with a
    persistence baseline (tomorrow = today) and, for water streams, a
    Newton's-law physics forecast."""
    try:
        from prophet import Prophet
    except ImportError:
        return None
    import logging
    logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

    s = series.dropna()
    n = len(s)
    first = max(int(n * 0.4), 24)
    last = n - horizon_steps
    if last <= first:
        return None
    cut_points = np.unique(np.linspace(first, last, origins).astype(int))
    rows, example = [], None
    for c in cut_points:
        train, test = s.iloc[:c], s.iloc[c:c + horizon_steps]
        m = Prophet(interval_width=0.95, daily_seasonality=True,
                    weekly_seasonality=False, yearly_seasonality=False)
        m.fit(pd.DataFrame({"ds": train.index.tz_convert(None), "y": train.values}))
        fut = pd.DataFrame({"ds": test.index.tz_convert(None)})
        fc = m.predict(fut)
        yhat, lo, hi = fc["yhat"].values, fc["yhat_lower"].values, fc["yhat_upper"].values
        actual = test.values
        persist = np.full_like(actual, train.values[-1])
        physics = None
        if air is not None:
            physics = newton_forecast(train, air[air.index <= train.index[-1]], horizon_steps, step_min)
            if physics is not None:
                physics = physics[: len(actual)]
        for h in range(len(actual)):
            rows.append({
                "origin": str(train.index[-1]), "h_min": (h + 1) * step_min,
                "actual": actual[h], "prophet": yhat[h], "lo": lo[h], "hi": hi[h],
                "persistence": persist[h],
                "physics": physics[h] if physics is not None else np.nan,
            })
        example = (train, test, fc)
    res = pd.DataFrame(rows)
    err_p = res.prophet - res.actual
    err_b = res.persistence - res.actual
    err_n = (res.physics - res.actual).dropna()
    summary = {
        "origins": int(len(cut_points)), "horizon_min": horizon_steps * step_min,
        "physics_mae": float(err_n.abs().mean()) if err_n.size else None,
        "physics_rmse": float(np.sqrt((err_n ** 2).mean())) if err_n.size else None,
        "prophet_mae": float(err_p.abs().mean()), "prophet_rmse": float(np.sqrt((err_p ** 2).mean())),
        "persistence_mae": float(err_b.abs().mean()), "persistence_rmse": float(np.sqrt((err_b ** 2).mean())),
        "coverage_95": float(((res.actual >= res.lo) & (res.actual <= res.hi)).mean()),
        "mean_interval_width": float((res.hi - res.lo).mean()),
    }
    return summary, res, example


# ------------------------------------------------------------------ figures

def savefig(fig, path):
    fig.tight_layout()
    fig.savefig(path, dpi=150)
    plt.close(fig)


def fmt(v, d=2):
    return "—" if v is None or (isinstance(v, float) and not math.isfinite(v)) else f"{v:.{d}f}"


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hours", type=float, default=48, help="analyse the last N hours (default 48)")
    ap.add_argument("--since", help="start time, ISO (overrides --hours)")
    ap.add_argument("--until", help="end time, ISO (default now)")
    ap.add_argument("--csv", help="analyse a CSV export instead of the database")
    ap.add_argument("--out", default="results", help="output folder (default results/)")
    ap.add_argument("--horizon-min", type=int, default=120, help="forecast horizon for the backtest")
    ap.add_argument("--origins", type=int, default=6, help="number of backtest origins")
    ap.add_argument("--max-lag-min", type=int, default=120, help="largest cross-correlation lag")
    args = ap.parse_args()

    until = pd.Timestamp(args.until, tz="UTC") if args.until else pd.Timestamp.now(tz="UTC")
    since = pd.Timestamp(args.since, tz="UTC") if args.since else until - pd.Timedelta(hours=args.hours)

    raw = load_from_csv(args.csv) if args.csv else load_from_db(since.to_pydatetime(), until.to_pydatetime())
    df = tidy(raw)
    if df.empty:
        print("No readings in that window.")
        return
    labels = node_order(df)
    run_dir = os.path.join(args.out, datetime.now().strftime("%Y%m%d-%H%M%S"))
    fig_dir = os.path.join(run_dir, "figures")
    os.makedirs(fig_dir, exist_ok=True)
    color = {lab: NODE_COLORS[i % len(NODE_COLORS)] for i, lab in enumerate(labels)}

    # Preserve the raw readings exactly as analysed
    df.to_csv(os.path.join(run_dir, "raw_readings.csv"), index=False)
    wide = {w: wide_frame(df, w) for w in WINDOWS_MIN}
    for w, frame in wide.items():
        frame.to_csv(os.path.join(run_dir, f"resampled_{w}min.csv"))
    print(f"{len(df)} readings from {len(labels)} nodes: {', '.join(labels)}")

    metrics = {"window": {"since": str(df.captured_at.min()), "until": str(df.captured_at.max())},
               "nodes": labels}

    # 1. Temporal aggregation
    agg = temporal_aggregation(df, labels)
    agg.to_csv(os.path.join(run_dir, "temporal_aggregation.csv"), index=False)
    noise = detrended_noise(df, labels)
    metrics["noise_sigma"] = noise

    fig, axes = plt.subplots(2, 1, figsize=(11, 7), sharex=True)
    w1 = wide[1]
    for lab in labels:
        axes[0].plot(w1.index, w1[f"{lab}{SEP}water"], color=color[lab], lw=1.8, label=f"{lab} water (DS18B20)")
        axes[0].plot(w1.index, w1[f"{lab}{SEP}air"], color=color[lab], lw=0.9, ls=":", label=f"{lab} air (DHT11)")
        axes[1].plot(w1.index, w1[f"{lab}{SEP}RH"], color=color[lab], lw=1.2, label=f"{lab} RH")
    axes[0].axhline(0, color="#868e96", lw=0.8)
    axes[0].set_ylabel("Temperature (°C)")
    axes[1].set_ylabel("Relative humidity (%)")
    axes[0].legend(fontsize=8, ncol=2)
    axes[1].legend(fontsize=8)
    axes[0].set_title("All six data streams (1-minute means)")
    savefig(fig, os.path.join(fig_dir, "01_all_streams.png"))

    fig, ax = plt.subplots(figsize=(7, 4.5))
    for lab in labels:
        sub = agg[(agg.node == lab) & (agg.stream == "air")]
        if not sub.empty:
            ax.plot(sub.samples_per_bucket, sub.within_bucket_sd, "o-", color=color[lab], label=f"{lab} air (DHT11)")
        sub = agg[(agg.node == lab) & (agg.stream == "water")]
        if not sub.empty:
            ax.plot(sub.samples_per_bucket, sub.within_bucket_sd, "s--", color=color[lab], label=f"{lab} water (DS18B20)")
    ax.set_xscale("log")
    ax.set_yscale("log")
    ax.set_xlabel("Samples per window (N)")
    ax.set_ylabel("Mean within-window std (°C)")
    ax.set_title("Spread inside 1, 5 and 15-minute windows")
    ax.legend(fontsize=8)
    savefig(fig, os.path.join(fig_dir, "02_window_spread.png"))

    # 2. Cross-node difference (ice minus refrigerated on the shared 1-minute grid)
    diff_stats = {}
    if len(labels) >= 2:
        a, b = labels[0], labels[1]
        fig, ax = plt.subplots(figsize=(11, 4))
        for stream, ls in [("water", "-"), ("air", ":")]:
            d = (w1[f"{a}{SEP}{stream}"] - w1[f"{b}{SEP}{stream}"]).dropna()
            if d.empty:
                continue
            diff_stats[stream] = {"mean": float(d.mean()), "std": float(d.std()), "min": float(d.min()),
                                  "max": float(d.max()), "minutes": int(d.size)}
            ax.plot(d.index, d.values, ls, lw=1.5, color="#495057", label=f"{stream}: {a} − {b}")
        ax.axhline(0, color="#adb5bd", lw=0.8)
        ax.set_ylabel("ΔT (°C)")
        ax.set_title(f"Cross-node difference ΔT(t) = T[{a}] − T[{b}]")
        ax.legend(fontsize=8)
        savefig(fig, os.path.join(fig_dir, "03_cross_node_difference.png"))
    metrics["difference"] = diff_stats

    # Physics: plateau, tau by two methods, and the melt-time prediction
    physics = {}
    w5 = wide[5]
    fig_d, ax_d = plt.subplots(figsize=(11, 4))
    fig_n, ax_n = plt.subplots(figsize=(7, 5))
    fig_l, ax_l = plt.subplots(figsize=(7, 5))
    for lab in labels:
        water1 = w1[f"{lab}{SEP}water"].dropna()
        if water1.empty:
            continue
        info = {}
        plateau = find_plateau(water1)
        if plateau:
            info["plateau"] = {"start": str(plateau["start"]), "end": str(plateau["end"]),
                               "minutes": plateau["minutes"], "complete": plateau["complete"]}
        seg = warming_segment(water1, plateau)
        air_mean = float(w1[f"{lab}{SEP}air"].dropna().mean())
        t_inf = air_mean
        info["t_inf_c"] = t_inf

        # dT/dt on 5-minute means (1-minute differences amplify the probe's
        # 0.0625 degC steps), reported in degC per hour
        water5 = w5[f"{lab}{SEP}water"]
        air5 = w5[f"{lab}{SEP}air"]
        dTdt = pd.Series(np.gradient(water5.values, 5.0) * 60.0, index=water5.index)
        ax_d.plot(dTdt.index, dTdt.values, color=color[lab], lw=1.3, label=lab)
        info["max_dTdt_c_per_h"] = float(np.nanmax(dTdt.values))

        if seg is not None and len(seg) > 10:
            t_min = (seg.index - seg.index[0]).total_seconds().values / 60.0
            a_fit = fit_tau_log(t_min, seg.values, t_inf)
            if a_fit:
                info["tau_log"] = {k: a_fit[k] for k in ("tau_min", "r2", "points")}
                gap = t_inf - seg.values
                n_fit = a_fit["stop_index"]
                m = np.zeros(gap.size, dtype=bool)
                m[:n_fit] = gap[:n_fit] > 0
                ax_l.plot(t_min[m], np.log(gap[m]), ".", ms=2, color=color[lab], label=f"{lab}: τ = {a_fit['tau_min']:.1f} min")
            seg5 = water5[water5.index >= seg.index[0]].dropna()
            b_fit = fit_tau_derivative(seg5, air5.reindex(seg5.index))
            if b_fit:
                info["tau_derivative"] = {k: b_fit[k] for k in ("tau_min", "r2", "points")}
                ax_n.plot(b_fit["x"], b_fit["y"] * 60, ".", ms=4, color=color[lab], alpha=0.6)
                xs = np.linspace(0, b_fit["x"].max(), 50)
                ax_n.plot(xs, b_fit["k"] * xs * 60, color=color[lab], lw=1.5,
                          label=f"{lab}: τ = {b_fit['tau_min']:.1f} min")
        physics[lab] = info

    ax_d.axhline(0, color="#adb5bd", lw=0.8)
    ax_d.set_ylabel("dT/dt (°C per hour)")
    ax_d.set_title("Rate of change of water temperature (central differences on 5-minute means)")
    ax_d.legend(fontsize=8)
    savefig(fig_d, os.path.join(fig_dir, "04_dTdt.png"))
    ax_n.set_xlabel("Driving difference T_air − T_water (°C)")
    ax_n.set_ylabel("dT/dt (°C per hour)")
    ax_n.set_title("Newton's law check: dT/dt = (T_air − T) / τ")
    ax_n.legend(fontsize=8)
    savefig(fig_n, os.path.join(fig_dir, "05_newton_derivative_fit.png"))
    ax_l.set_xlabel("Minutes into warming phase")
    ax_l.set_ylabel("ln(T∞ − T)")
    ax_l.set_title("Log-linear fit of the warming phase")
    ax_l.legend(fontsize=8)
    savefig(fig_l, os.path.join(fig_dir, "06_log_linear_fit.png"))

    # Melt-time prediction: plateau ~= tau * L_f / (c_w * T_inf), using the
    # tau measured on the cup that never had ice
    prediction = None
    if len(labels) >= 2:
        ice, ref = labels[0], labels[1]
        p_ice = physics.get(ice, {}).get("plateau")
        # tau of the reference cup: mean of the two independent methods
        taus = [physics.get(ref, {}).get(k, {}).get("tau_min") for k in ("tau_log", "tau_derivative")]
        taus = [t for t in taus if t]
        tau_ref = {"tau_min": float(np.mean(taus))} if taus else None
        if p_ice and tau_ref:
            t_inf = physics[ice]["t_inf_c"]
            predicted = tau_ref["tau_min"] * L_F / (C_W * t_inf)
            prediction = {
                "ice_node": ice, "reference_node": ref,
                "tau_reference_min": tau_ref["tau_min"], "t_inf_c": t_inf,
                "predicted_plateau_min": predicted,
                "measured_plateau_min": p_ice["minutes"],
                "measured_complete": p_ice["complete"],
                "ratio_measured_to_predicted": p_ice["minutes"] / predicted,
            }
    metrics["physics"] = physics
    metrics["melt_prediction"] = prediction

    # 4. Cross-correlation on first differences of 5-minute means (removes the
    # shared slow trends that would otherwise make everything look correlated)
    xc = {}
    pairs = []
    if len(labels) >= 2:
        a, b = labels[0], labels[1]
        pairs = [(f"{b}{SEP}air", f"{a}{SEP}air"), (f"{b}{SEP}RH", f"{a}{SEP}RH"),
                 (f"{b}{SEP}air", f"{b}{SEP}water"), (f"{a}{SEP}air", f"{a}{SEP}water"),
                 (f"{b}{SEP}air", f"{b}{SEP}RH")]
    elif labels:
        a = labels[0]
        pairs = [(f"{a}{SEP}air", f"{a}{SEP}water"), (f"{a}{SEP}air", f"{a}{SEP}RH")]
    max_lag = max(1, args.max_lag_min // 5)
    fig, ax = plt.subplots(figsize=(9, 5))
    for x_name, y_name in pairs:
        if x_name not in w5 or y_name not in w5:
            continue
        x = w5[x_name].diff().values
        y = w5[y_name].diff().values
        lags, vals = cross_correlation(x, y, max_lag)
        if np.all(np.isnan(vals)):
            continue
        i = int(np.nanargmax(np.abs(vals)))
        level = w5[[x_name, y_name]].dropna()
        xc[f"{x_name} -> {y_name}"] = {
            "peak_r": float(vals[i]), "peak_lag_min": int(lags[i] * 5),
            "zero_lag_r": float(vals[list(lags).index(0)]),
            "level_pearson_r": float(level.corr().iloc[0, 1]) if len(level) > 2 else float("nan"),
        }
        ax.plot(lags * 5, vals, lw=1.3, label=f"{x_name} → {y_name}")
    ax.axvline(0, color="#adb5bd", lw=0.8)
    ax.set_xlabel("Lag (minutes; positive = second stream follows the first)")
    ax.set_ylabel("Normalised cross-correlation of first differences")
    ax.set_title("Cross-correlation between streams")
    ax.legend(fontsize=7)
    savefig(fig, os.path.join(fig_dir, "07_cross_correlation.png"))
    metrics["cross_correlation"] = xc

    # 5. Forecast evaluation: Prophet vs persistence on 5-minute means
    backtests = {}
    horizon_steps = max(1, args.horizon_min // 5)
    targets = [f"{lab}{SEP}{s}" for lab in labels for s in ("water", "air")]
    example_plot = None
    for name in targets:
        if name not in w5:
            continue
        air_series = None
        if name.endswith(f"{SEP}water"):
            air_series = w5[name[: -len("water")] + "air"].dropna()
        bt = prophet_backtest(w5[name], horizon_steps, args.origins, 5, air=air_series)
        if bt is None:
            continue
        summary, res, example = bt
        backtests[name] = summary
        res.to_csv(os.path.join(run_dir, f"backtest_{name.replace(SEP, '_').replace(' ', '_')}.csv"), index=False)
        if example_plot is None and name.endswith("water"):
            example_plot = (name, example, res)
    metrics["forecast_backtest"] = backtests

    if example_plot:
        name, (train, test, fc), res = example_plot
        fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))
        tail = train.iloc[-min(len(train), 72):]
        axes[0].plot(tail.index, tail.values, color="#495057", lw=1.2, label="training data")
        axes[0].plot(test.index, test.values, color="#2b8a3e", lw=1.5, label="what happened")
        idx = test.index
        axes[0].plot(idx, fc["yhat"].values, color="#7048e8", ls="--", lw=1.5, label="Prophet forecast")
        axes[0].fill_between(idx, fc["yhat_lower"].values, fc["yhat_upper"].values, color="#7048e8", alpha=0.15, label="95 % interval")
        last_phys = res[res.origin == res.origin.iloc[-1]].physics.values
        if np.isfinite(last_phys).any():
            axes[0].plot(idx, last_phys[: len(idx)], color="#2b8a3e", ls="-.", lw=1.5, label="Newton physics forecast")
        axes[0].set_title(f"Last backtest origin: {name}")
        axes[0].legend(fontsize=8)
        by_h = res.assign(ep=(res.prophet - res.actual).abs(), eb=(res.persistence - res.actual).abs()) \
                  .groupby("h_min")[["ep", "eb"]].mean()
        axes[1].plot(by_h.index, by_h.ep, "o-", color="#7048e8", label="Prophet MAE")
        axes[1].plot(by_h.index, by_h.eb, "s--", color="#868e96", label="Persistence MAE")
        if res.physics.notna().any():
            en = (res.physics - res.actual).abs().groupby(res.h_min).mean()
            axes[1].plot(en.index, en.values, "^-", color="#2b8a3e", label="Newton physics MAE")
        axes[1].set_xlabel("Forecast horizon (minutes)")
        axes[1].set_ylabel("Mean absolute error (°C)")
        axes[1].set_title("Error vs horizon")
        axes[1].legend(fontsize=8)
        savefig(fig, os.path.join(fig_dir, "08_forecast_backtest.png"))

    # ------------------------------------------------------------ write-up
    with open(os.path.join(run_dir, "metrics.json"), "w") as f:
        json.dump(metrics, f, indent=2, default=str)

    L = []
    L.append("# Frozen vs refrigerated water — analysis\n")
    L.append(f"Window: {metrics['window']['since']} → {metrics['window']['until']}  ")
    L.append(f"Nodes: {', '.join(labels)} · {len(df)} raw readings\n")

    L.append("## 1. Temporal aggregation\n")
    L.append("| Node | Stream | Window | Buckets | Mean | Std | Min | Max | Within-window std |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for _, r in agg.iterrows():
        L.append(f"| {r.node} | {r.stream} | {r.window_min} min | {r.buckets} | {fmt(r['mean'])} | {fmt(r['std'])} | "
                 f"{fmt(r['min'])} | {fmt(r['max'])} | {fmt(r.within_bucket_sd, 3)} |")
    L.append("\nSensor noise estimated from first differences (σ = std(Δx)/√2):\n")
    for k, v in noise.items():
        L.append(f"- {k}: **{v:.3f} °C**")

    if diff_stats:
        L.append(f"\n## 2. Cross-node difference ({labels[0]} − {labels[1]})\n")
        for s, d in diff_stats.items():
            L.append(f"- {s}: mean **{d['mean']:.2f} °C**, std {d['std']:.2f}, range {d['min']:.2f} to {d['max']:.2f} ({d['minutes']} matched minutes)")

    L.append("\n## 3. Rates of change and the warming time constant\n")
    for lab, info in physics.items():
        L.append(f"**{lab}** (T∞ = mean air {info['t_inf_c']:.2f} °C)")
        if "plateau" in info:
            p = info["plateau"]
            L.append(f"- Melting plateau: **{p['minutes']:.0f} min** {'(ice fully melted)' if p['complete'] else '(still melting at end of window)'}")
        L.append(f"- Fastest warming: {info['max_dTdt_c_per_h']:.2f} °C per hour")
        if "tau_log" in info:
            t = info["tau_log"]
            L.append(f"- τ from log-linear fit: **{t['tau_min']:.1f} min** (R² = {t['r2']:.3f}, {t['points']} points)")
        if "tau_derivative" in info:
            t = info["tau_derivative"]
            L.append(f"- τ from dT/dt vs (T_air − T): **{t['tau_min']:.1f} min** (R² = {t['r2']:.3f}, {t['points']} points)")
        L.append("")
    if prediction:
        p = prediction
        L.append("### Melt-time prediction\n")
        L.append("Same water mass and cup ⇒ same hA, so t_melt / τ = L_f / (c_w · T∞).\n")
        L.append(f"- τ of {p['reference_node']} (mean of both methods): {p['tau_reference_min']:.1f} min, T∞ = {p['t_inf_c']:.2f} °C")
        L.append(f"- Predicted plateau: **{p['predicted_plateau_min']:.0f} min**")
        L.append(f"- Measured plateau: **{p['measured_plateau_min']:.0f} min** "
                 f"({'complete' if p['measured_complete'] else 'still melting — a lower bound'})")
        L.append(f"- Measured / predicted: {p['ratio_measured_to_predicted']:.2f}\n")

    if xc:
        L.append("## 4. Cross-correlation (first differences of 5-minute means)\n")
        L.append("| Pair | Peak r | Lag at peak | r at zero lag | Pearson r on levels |")
        L.append("|---|---|---|---|---|")
        for k, v in xc.items():
            L.append(f"| {k} | {v['peak_r']:.2f} | {v['peak_lag_min']} min | {v['zero_lag_r']:.2f} | {fmt(v['level_pearson_r'])} |")

    if backtests:
        L.append(f"\n## 5. Forecast evaluation (rolling origin, {args.horizon_min}-minute horizon)\n")
        L.append("| Stream | Origins | Prophet MAE | Newton MAE | Persistence MAE | Prophet RMSE | Prophet 95 % coverage | Mean interval width |")
        L.append("|---|---|---|---|---|---|---|---|")
        for k, v in backtests.items():
            L.append(f"| {k} | {v['origins']} | {v['prophet_mae']:.2f} | {fmt(v['physics_mae'])} | {v['persistence_mae']:.2f} | "
                     f"{v['prophet_rmse']:.2f} | {v['coverage_95'] * 100:.0f} % | {v['mean_interval_width']:.2f} °C |")
        L.append("\nMAE in °C. A well-calibrated 95 % interval contains about 95 % of later observations. "
                 "A model only earns its place where its error beats the persistence baseline "
                 "(\"the next two hours look like now\"). Newton = physics forecast with τ estimated from the training data.")

    with open(os.path.join(run_dir, "summary.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(L) + "\n")
    print(f"Done. Results in {run_dir}")


if __name__ == "__main__":
    main()

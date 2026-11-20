'use client';

// Alarm settings panel: view, edit, add and delete alarm rules, and send a
// test push. If the server has ALARM_ADMIN_PIN set, the panel asks for the
// PIN before showing anything.
import { useCallback, useEffect, useState } from 'react';

type Channel = 'water' | 'air' | 'humidity';
type Condition = 'above' | 'below' | 'rising' | 'falling';

interface Rule {
  id: string;
  deviceUid: string | null;
  channel: Channel;
  condition: Condition;
  threshold: number;
  windowMin: number;
  enabled: boolean;
  push: boolean;
}
type Draft = Omit<Rule, 'id' | 'threshold'> & { threshold: string };
interface DeviceOpt { deviceUid: string; label: string }

const PIN_KEY = 'bayes-iot-alarm-pin';
const CHANNEL_LABEL: Record<Channel, string> = { water: 'Water (probe)', air: 'Air (DHT11)', humidity: 'Humidity' };
const CONDITION_LABEL: Record<Condition, string> = {
  above: 'is above', below: 'is below', rising: 'rises faster than', falling: 'falls faster than',
};
const unitFor = (ch: Channel, cond: Condition) =>
  (ch === 'humidity' ? '%' : '°C') + (cond === 'rising' || cond === 'falling' ? '/min' : '');

const toDraft = (r: Rule): Draft => ({ ...r, threshold: String(r.threshold) });
const sameAs = (d: Draft, r: Rule) =>
  d.deviceUid === r.deviceUid && d.channel === r.channel && d.condition === r.condition &&
  Number(d.threshold) === r.threshold && d.windowMin === r.windowMin && d.enabled === r.enabled && d.push === r.push;

const emptyDraft = (): Draft => ({
  deviceUid: null, channel: 'air', condition: 'above', threshold: '30', windowMin: 5, enabled: true, push: true,
});

function readPin() {
  try { return sessionStorage.getItem(PIN_KEY) ?? ''; } catch { return ''; }
}
function savePin(pin: string) {
  try { sessionStorage.setItem(PIN_KEY, pin); } catch { /* storage blocked: keep it in memory only */ }
}

const inputCls = 'bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-white';

function RuleEditor({ draft, devices, onChange }: {
  draft: Draft; devices: DeviceOpt[]; onChange: (d: Draft) => void;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className={inputCls} value={draft.deviceUid ?? ''} onChange={(e) => set({ deviceUid: e.target.value || null })}>
        <option value="">All nodes</option>
        {devices.map((d) => <option key={d.deviceUid} value={d.deviceUid}>{d.label}</option>)}
      </select>
      <select className={inputCls} value={draft.channel} onChange={(e) => set({ channel: e.target.value as Channel })}>
        {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => <option key={c} value={c}>{CHANNEL_LABEL[c]}</option>)}
      </select>
      <select className={inputCls} value={draft.condition} onChange={(e) => set({ condition: e.target.value as Condition })}>
        {(Object.keys(CONDITION_LABEL) as Condition[]).map((c) => <option key={c} value={c}>{CONDITION_LABEL[c]}</option>)}
      </select>
      <input className={`${inputCls} w-24`} type="number" step="any" value={draft.threshold}
        onChange={(e) => set({ threshold: e.target.value })} aria-label="Threshold" />
      <span className="text-slate-400">{unitFor(draft.channel, draft.condition)}</span>
      <span className="text-slate-500">using</span>
      <select className={inputCls} value={draft.windowMin} onChange={(e) => set({ windowMin: Number(e.target.value) })}>
        {[1, 5, 15].map((w) => <option key={w} value={w}>{w}-min mean</option>)}
      </select>
      <label className="flex items-center gap-1 text-slate-300 ml-2">
        <input type="checkbox" checked={draft.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> On
      </label>
      <label className="flex items-center gap-1 text-slate-300">
        <input type="checkbox" checked={draft.push} onChange={(e) => set({ push: e.target.checked })} /> Phone push
      </label>
      {draft.windowMin === 1 && (draft.condition === 'rising' || draft.condition === 'falling') && (
        <span className="basis-full text-xs text-amber-300">
          1-minute means are noisy for rates: in testing, a steady room set this off about every 30 minutes. 5 minutes is safer.
        </span>
      )}
    </div>
  );
}

export default function AlarmSettings() {
  const [open, setOpen] = useState(false);
  const [pin, setPin] = useState('');
  const [pinInput, setPinInput] = useState('');
  const [needPin, setNeedPin] = useState(false);
  const [rules, setRules] = useState<Rule[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [devices, setDevices] = useState<DeviceOpt[]>([]);
  const [newRule, setNewRule] = useState<Draft | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const call = useCallback(async (path: string, init: RequestInit = {}, usePin = pin) => {
    const res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(usePin ? { 'x-alarm-pin': usePin } : {}) },
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) setNeedPin(true);
    return { ok: res.ok, status: res.status, data };
  }, [pin]);

  const load = useCallback(async (usePin = pin) => {
    const { ok, status: code, data } = await call('/api/alarm-rules', {}, usePin);
    if (code === 401) {
      if (usePin) setStatus('Wrong PIN.');
      return;
    }
    if (!ok) { setStatus(data.error ?? 'Could not load the rules.'); return; }
    setNeedPin(false);
    setRules(data.rules);
    setDrafts(Object.fromEntries((data.rules as Rule[]).map((r) => [r.id, toDraft(r)])));
    setDevices(data.devices);
    setPushEnabled(data.pushEnabled);
    setStatus(null);
  }, [call, pin]);

  useEffect(() => {
    if (!open) return;
    const stored = readPin();
    setPin(stored);
    load(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submitPin = async () => {
    savePin(pinInput);
    setPin(pinInput);
    await load(pinInput);
  };

  const body = (d: Draft) => JSON.stringify({ ...d, threshold: Number(d.threshold) });

  const saveRule = async (id: string) => {
    setBusy(true);
    const { ok, data } = await call(`/api/alarm-rules/${id}`, { method: 'PATCH', body: body(drafts[id]) });
    setStatus(ok ? 'Rule saved.' : data.error ?? 'Save failed.');
    if (ok) await load();
    setBusy(false);
  };

  const deleteRule = async (id: string) => {
    setBusy(true);
    const { ok, data } = await call(`/api/alarm-rules/${id}`, { method: 'DELETE' });
    setStatus(ok ? 'Rule deleted.' : data.error ?? 'Delete failed.');
    if (ok) await load();
    setBusy(false);
  };

  const addRule = async () => {
    if (!newRule) return;
    setBusy(true);
    const { ok, data } = await call('/api/alarm-rules', { method: 'POST', body: body(newRule) });
    setStatus(ok ? 'Rule added.' : data.error ?? 'Add failed.');
    if (ok) { setNewRule(null); await load(); }
    setBusy(false);
  };

  const testPush = async () => {
    setBusy(true);
    const { ok, data } = await call('/api/alarm-rules/test', { method: 'POST' });
    setStatus(ok ? 'Test push sent. Check your phone.' : data.error ?? 'Test push failed.');
    setBusy(false);
  };

  return (
    <div className="mb-6">
      <button onClick={() => setOpen(!open)}
        className="text-sm px-3 py-1.5 rounded border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
        {open ? 'Close alarm settings' : 'Alarm settings'}
      </button>

      {open && (
        <div className="bg-slate-900 rounded-lg p-6 mt-3">
          {needPin ? (
            <form className="flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); submitPin(); }}>
              <span className="text-slate-300">Enter the PIN to change alarm settings</span>
              <input className={`${inputCls} w-40`} type="password" autoComplete="off" value={pinInput}
                onChange={(e) => setPinInput(e.target.value)} aria-label="PIN" />
              <button type="submit" className="px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-sm">Unlock</button>
              {status && <span className="text-sm text-red-300">{status}</span>}
            </form>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
                <h2 className="text-xl font-semibold">Alarm rules</h2>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-slate-400">
                    Phone push {pushEnabled ? 'is on' : 'is off: set NTFY_TOPIC in Vercel'}
                  </span>
                  <button onClick={testPush} disabled={busy || !pushEnabled}
                    className="text-sm px-3 py-1 rounded border border-slate-600 hover:bg-slate-800 disabled:opacity-40">
                    Send test push
                  </button>
                </div>
              </div>

              <p className="text-sm text-slate-400 mb-4">
                Checked on every reading. Rates compare two window means, two windows apart.
                An alarm clears once the value is back inside its limit (2 °C or 5 % for levels, half the rate for rates),
                and the same rule cannot fire again on a node for 30 minutes.
              </p>

              <div className="space-y-3">
                {rules.length === 0 && <p className="text-slate-400 text-sm">No rules yet.</p>}
                {rules.map((r) => {
                  const d = drafts[r.id];
                  if (!d) return null;
                  const dirty = !sameAs(d, r);
                  return (
                    <div key={r.id}
                      className={`rounded border p-3 flex flex-wrap items-center justify-between gap-3 ${dirty ? 'border-amber-500' : 'border-slate-800'} ${r.enabled ? '' : 'opacity-60'}`}>
                      <RuleEditor draft={d} devices={devices} onChange={(nd) => setDrafts({ ...drafts, [r.id]: nd })} />
                      <div className="flex gap-2">
                        <button onClick={() => saveRule(r.id)} disabled={busy || !dirty}
                          className="text-sm px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-30">Save</button>
                        <button onClick={() => deleteRule(r.id)} disabled={busy}
                          className="text-sm px-3 py-1 rounded border border-red-800 text-red-300 hover:bg-red-950">Delete</button>
                      </div>
                    </div>
                  );
                })}

                {newRule ? (
                  <div className="rounded border border-emerald-700 p-3 flex flex-wrap items-center justify-between gap-3">
                    <RuleEditor draft={newRule} devices={devices} onChange={setNewRule} />
                    <div className="flex gap-2">
                      <button onClick={addRule} disabled={busy}
                        className="text-sm px-3 py-1 rounded bg-emerald-600 hover:bg-emerald-500">Add</button>
                      <button onClick={() => setNewRule(null)}
                        className="text-sm px-3 py-1 rounded border border-slate-600 hover:bg-slate-800">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setNewRule(emptyDraft())}
                    className="text-sm px-3 py-1.5 rounded border border-dashed border-slate-600 text-slate-300 hover:bg-slate-800">
                    + Add rule
                  </button>
                )}
              </div>

              {status && <p className="text-sm text-slate-300 mt-4">{status}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

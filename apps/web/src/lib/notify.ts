// Phone push through ntfy (https://ntfy.sh). Install the ntfy app, subscribe
// to the topic named in NTFY_TOPIC, and alarms arrive as notifications.
// Anyone who knows the topic name can read it, so pick a long random one.

export async function pushAlarm(title: string, message: string, opts: { resolved?: boolean } = {}) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) return false; // push not configured; the dashboard still shows the alarm
  const server = process.env.NTFY_SERVER || 'https://ntfy.sh';
  const dashboard = process.env.DASHBOARD_URL || 'https://bayes-iot-pipeline.vercel.app';
  try {
    const res = await fetch(`${server}/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: {
        // Header values must be plain ASCII; the body can hold °C and dashes.
        Title: title.replace(/[^\x20-\x7E]/g, ''),
        Priority: opts.resolved ? 'default' : 'high',
        Tags: opts.resolved ? 'white_check_mark' : 'rotating_light',
        Click: dashboard,
      },
      body: message,
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch (e) {
    console.error('ntfy push failed:', e);
    return false;
  }
}

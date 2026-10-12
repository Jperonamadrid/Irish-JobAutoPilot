// Automatic daily run: each person can have it start by itself at a set time. It needs JobPilot
// to be open; if the computer was off or asleep at that time, the run starts as soon as JobPilot
// is next open that day. One run a day at most.
const localDate = d => d.toLocaleDateString('en-CA');   // YYYY-MM-DD in this computer's time zone
const minutes = hhmm => { const [h, m] = String(hhmm || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };

function isDue(settings, now = new Date()) {
  const sc = settings.schedule;
  if (!sc?.on || !settings.setupDone || sc.lastRun === localDate(now)) return false;
  if (sc.days === 'weekdays' && [0, 6].includes(now.getDay())) return false;
  const at = minutes(sc.time);
  return at != null && now.getHours() * 60 + now.getMinutes() >= at;
}

// Switching the schedule on (or moving it) after today's time has passed waits until tomorrow,
// instead of starting a long run the moment you press Save.
function onSave(settings, now = new Date()) {
  return isDue(settings, now) ? { ...settings.schedule, lastRun: localDate(now) } : settings.schedule;
}

module.exports = { isDue, onSave, localDate };

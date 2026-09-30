// Study Hall Tracker. Everything is saved on this phone (localStorage). No server, no account.
const WINDOW_HOURS = 4;      // you can log a study hall up to 4 hours after it ends
const EVENING_OPENS = '18:50'; // evening check unlocks at 6:50 PM (phone's local time)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day, hhmm) => { const [h, m] = hhmm.split(':'); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), +h, +m); };
const fmt = hhmm => { const [h, m] = hhmm.split(':'); return `${(+h % 12) || 12}:${m} ${+h < 12 ? 'AM' : 'PM'}`; };

// The study halls on a given day, with the time each one's logging window closes.
function slotsOn(day, schedule) {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return schedule.filter(s => s.day === day.getDay()).map(s => {
    const end = at(day, s.end);
    return { key: `${ymd(day)} ${s.start}`, day, start: s.start, endStr: s.end, end,
             close: new Date(Math.min(end.getTime() + WINDOW_HOURS * 3600e3, midnight)) }; // same-day only
  }).sort((a, b) => a.end - b.end);
}

// Any study hall whose window closed without a log is saved as "missed" (counts as slacked).
function sweep(state, now) {
  const since = new Date(state.since);
  for (let d = new Date(since.getFullYear(), since.getMonth(), since.getDate()); d <= now; d.setDate(d.getDate() + 1))
    for (const s of slotsOn(d, state.schedule))
      if (s.close > since && s.close <= now && !state.logs[s.key]) state.logs[s.key] = { r: 'missed' };
}

const openSlot = (state, now) =>
  slotsOn(now, state.schedule).find(s => s.end <= now && now < s.close && !state.logs[s.key]);

function nextSlot(state, now) {
  for (let i = 0; i < 8; i++) {
    const s = slotsOn(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), state.schedule).find(s => s.end > now);
    if (s) return s;
  }
}

const mondayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);

// Streak rules, replayed over every study hall you've ever logged (so old logs count too):
// Homework = +1. Slacked/missed = a freeze saves the streak if you have one, otherwise it breaks.
// You get +1 freeze every Monday, and +1 for Homework at the very next study hall after a break. Never more than 2.
function scoreboard(logs, now) {
  let streak = 0, best = 0, freezes = 0, week = null, last = null;
  const newWeek = day => { // hand out the Monday freezes
    const monday = mondayOf(day).getTime();
    freezes = week === null ? 1 : Math.min(2, freezes + Math.round((monday - week) / 6048e5));
    week = monday;
  };
  for (const k of Object.keys(logs).sort()) {
    const [y, m, d] = k.slice(0, 10).split('-');
    newWeek(new Date(+y, m - 1, +d));
    if (logs[k].r === 'hw') {
      if (last === 'broke') freezes = Math.min(2, freezes + 1);
      last = last === 'broke' ? 'comeback' : 'hw';
      best = Math.max(best, ++streak);
    } else if (streak && freezes) { freezes--; last = 'frozen'; }
    else { last = streak ? 'broke' : 'miss'; streak = 0; }
  }
  newWeek(now);
  return { streak, best, freezes, last };
}

// This week = Monday through Sunday.
function week(state, now) {
  const from = ymd(mondayOf(now));
  const logs = Object.entries(state.logs).filter(([k]) => k >= from).map(([, v]) => v);
  const hw = logs.filter(l => l.r === 'hw').length;
  return {
    pct: logs.length ? Math.round(100 * hw / logs.length) : null,
    nights: Object.entries(state.evening).filter(([k, yes]) => k >= from && yes).length,
  };
}

if (typeof module !== 'undefined') module.exports = { ymd, at, slotsOn, sweep, openSlot, scoreboard, week, putVar };

// Saves a private setting ("Actions variable") in your GitHub repo. Used by the app to sync and by the reminder script.
async function putVar(token, name, value) {
  const url = 'https://api.github.com/repos/leomoroz2011/studyhall/actions/variables';
  const req = method => fetch(method === 'POST' ? url : `${url}/${name}`, { method, body: JSON.stringify({ name, value }),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
  let r = await req('PATCH');
  if (r.status === 404) r = await req('POST'); // first time: it doesn't exist yet
  if (!r.ok) throw new Error(r.status === 401 ? 'the token is wrong or expired' : `GitHub said ${r.status}`);
}

if (typeof document !== 'undefined') {
  const KEY = 'studyhall';
  const $ = s => document.querySelector(s);
  let state = JSON.parse(localStorage.getItem(KEY)) || { schedule: [], logs: {}, evening: {}, since: null };
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  function render() {
    const now = new Date();
    const setUp = state.schedule.length > 0;
    if (setUp) { sweep(state, now); save(); }
    $('#main').hidden = !setUp;
    if (!setUp) { if ($('#settings').hidden) showSettings(); return; } // don't wipe rows you're typing in

    // Study hall log
    const slot = openSlot(state, now);
    $('#log-open').hidden = !slot;
    $('#log-closed').hidden = !!slot;
    if (slot) {
      $('#log-q').textContent = `Study hall ended at ${fmt(slot.endStr)}. How did you use it?`;
      $('#log-deadline').textContent = `You can log this until ${fmt(`${pad(slot.close.getHours())}:${pad(slot.close.getMinutes())}`)}.`;
    } else {
      const n = nextSlot(state, now);
      const clock = `It's ${DAYS[now.getDay()]} ${fmt(`${pad(now.getHours())}:${pad(now.getMinutes())}`)}.`;
      $('#log-closed').textContent = n
        ? `${clock} Next study hall: ${ymd(n.day) === ymd(now) ? 'Today' : DAYS[n.day.getDay()]} ${fmt(n.start)}–${fmt(n.endStr)}. You can log it once it ends at ${fmt(n.endStr)}.`
        : `${clock} Nothing to log right now.`;
    }

    // Evening check
    const today = ymd(now), answer = state.evening[today];
    const eveningOpen = now >= at(now, EVENING_OPENS);
    $('#eve-ask').hidden = !(eveningOpen && answer === undefined);
    $('#eve-msg').hidden = !$('#eve-ask').hidden;
    $('#eve-msg').textContent = answer !== undefined
      ? `Answered for tonight: ${answer ? 'Yes 😬' : 'No 🎉'}`
      : `Opens at ${fmt(EVENING_OPENS)}.`;

    // Streak + scoreboard
    const sb = scoreboard(state.logs, now), w = week(state, now);
    $('#s-streak').textContent = sb.streak;
    $('#s-best').textContent = sb.best;
    $('#s-freezes').textContent = sb.freezes;
    $('#celebrate').hidden = sb.streak !== 7;
    $('#s-event').textContent = {
      comeback: 'Comeback bonus earned! 🧊 +1 freeze',
      frozen: '🧊 A freeze saved your streak. Phew.',
      broke: '💔 Streak broke. Log Homework at your next study hall to earn a comeback freeze.',
    }[sb.last] || '';
    $('#s-pct').textContent = w.pct === null ? '—' : `${w.pct}%`;
    $('#s-nights').textContent = w.nights;
  }

  function saveLog(result, note) {
    const now = new Date(), slot = openSlot(state, now);
    if (!slot) { alert('Too late: this study hall can’t be logged anymore.'); return render(); }
    state.logs[slot.key] = { r: result, note, at: now.toISOString() };
    save();
    sync();
    $('#hw-form').hidden = true;
    $('#hw-note').value = '';
    render();
  }

  $('#btn-hw').onclick = () => { $('#hw-form').hidden = false; $('#hw-note').focus(); };
  $('#btn-slack').onclick = () => saveLog('slack');
  $('#btn-hw-save').onclick = () => {
    const note = $('#hw-note').value.trim();
    if (!note) { $('#hw-error').hidden = false; return; }
    $('#hw-error').hidden = true;
    saveLog('hw', note);
  };
  $('#eve-yes').onclick = () => { state.evening[ymd(new Date())] = true; save(); render(); sync(); };
  $('#eve-no').onclick = () => { state.evening[ymd(new Date())] = false; save(); render(); sync(); };

  // Schedule editor
  function addRow(s = { day: 1, start: '', end: '' }) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<select>${DAYS.map((d, i) => `<option value="${i}">${d}</option>`).join('')}</select>
      <input type="time" aria-label="Start"><span>to</span><input type="time" aria-label="End">
      <button class="x" aria-label="Remove">✕</button>`;
    const [sel, start, end] = row.querySelectorAll('select, input');
    sel.value = s.day; start.value = s.start; end.value = s.end;
    row.querySelector('.x').onclick = () => row.remove();
    $('#rows').append(row);
  }
  function showSettings() {
    $('#rows').innerHTML = '';
    (state.schedule.length ? state.schedule : [undefined]).forEach(addRow);
    $('#settings').hidden = false;
    $('#btn-cancel').hidden = !state.schedule.length;
  }
  $('#btn-edit').onclick = showSettings;
  // New line copies the times from the last line and moves to the next day.
  $('#btn-add').onclick = () => {
    const last = [...document.querySelectorAll('#rows .row')].pop();
    if (!last) return addRow();
    const [sel, start, end] = last.querySelectorAll('select, input');
    addRow({ day: (+sel.value + 1) % 7, start: start.value, end: end.value });
  };
  $('#btn-cancel').onclick = () => { $('#settings').hidden = true; };
  $('#btn-save-sched').onclick = () => {
    const rows = [...document.querySelectorAll('#rows .row')];
    const schedule = rows.map(r => {
      const [sel, start, end] = r.querySelectorAll('select, input');
      return { day: +sel.value, start: start.value, end: end.value };
    });
    if (!schedule.length) return alert('Add at least one study hall.');
    // A half-typed time (e.g. AM/PM not picked) reads as empty, so point at the exact line.
    const bad = schedule.map(s => !s.start || !s.end || s.end <= s.start);
    rows.forEach((r, i) => r.classList.toggle('bad', bad[i]));
    const badDays = schedule.filter((s, i) => bad[i]).map(s => DAYS[s.day]);
    if (badDays.length) return alert(`Check the red line(s): ${badDays.join(', ')}.\n\nClick each time and make sure the hour, minutes AND AM/PM are all filled in. The end has to be after the start.`);
    if (state.schedule.length) sweep(state, new Date()); // lock in misses from the old schedule first
    state.schedule = schedule;
    state.since = new Date().toISOString(); // the new schedule only counts from now on
    save();
    $('#settings').hidden = true;
    render();
    sync();
  };

  // 6:50 PM reminder: the phone gives us an address, GitHub sends the notification to it each evening.
  const PUSH_KEY = 'BKnyV02fu2IcOi6q4_Oe1Q9XYG0P4gjLHRZCzh0xnfJbIfmSZOH8tVELvLWGK6Bb97q-LCqvUc6I6aDcjsQu6lQ';
  $('#btn-notify').onclick = async () => {
    if (!('PushManager' in window)) return alert('Open Study Hall from your home-screen icon first, then tap this again.');
    try {
      if (await Notification.requestPermission() !== 'granted')
        return alert('Notifications are off. Turn them on in Settings → Notifications → Study Hall.');
      const reg = await navigator.serviceWorker.ready;
      const key = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const code = JSON.stringify(sub);
      // Same code you already sent to GitHub = nothing to do. Only show it if it's new (or the phone changed it).
      if (code === localStorage.getItem('pushSent')) return alert('Your 6:50 PM reminder is already on ✅');
      $('#sub-json').value = code;
      $('#notify-code').hidden = false;
    } catch (err) { alert(`Couldn’t turn on the reminder: ${err.message}`); }
  };
  $('#btn-copy-sub').onclick = () => navigator.clipboard.writeText($('#sub-json').value).then(() => {
    localStorage.setItem('pushSent', $('#sub-json').value);
    $('#notify-code').hidden = true;
    $('#btn-notify').textContent = '6:50 PM reminder is on ✅';
    alert('Copied! Paste it into GitHub (the PUSH_SUBSCRIPTION secret) and you’re done.');
  });
  if (localStorage.getItem('pushSent')) $('#btn-notify').textContent = '6:50 PM reminder is on ✅';

  // Smart reminders: sends a copy of your progress to your private GitHub settings, so the reminder
  // knows your real streak, when study hall ends, and whether you've opened the app. Only on the device you connect.
  async function sync() {
    const token = localStorage.getItem('ghToken');
    if (!token) return;
    const logs = Object.fromEntries(Object.entries(state.logs).map(([k, v]) => [k, { r: v.r }])); // notes stay on your phone
    try {
      // ponytail: GitHub caps a variable at 48 KB, roughly 5+ years of study halls
      await putVar(token, 'STATE', JSON.stringify({ ...state, logs, lastOpen: new Date().toISOString() }));
      $('#sync-status').textContent = `Smart reminders synced ✓ ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
    } catch (err) { $('#sync-status').textContent = `Couldn’t sync: ${err.message}`; }
  }
  $('#btn-sync').onclick = () => {
    const token = prompt('Paste your GitHub token (starts with github_pat_):');
    if (!token?.trim()) return;
    localStorage.setItem('ghToken', token.trim());
    $('#btn-sync').textContent = 'Smart reminders connected ✓';
    sync();
  };
  if (localStorage.getItem('ghToken')) $('#btn-sync').textContent = 'Smart reminders connected ✓';

  // Backup
  $('#btn-export').onclick = async () => {
    const file = new File([JSON.stringify(state, null, 2)], `study-hall-backup-${ymd(new Date())}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
  };
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.schedule) || !data.logs || !data.evening) throw 0;
      if (!confirm('Replace everything in the app with this backup?')) return;
      state = data;
      save();
      render();
      sync();
    } catch { alert('That file isn’t a Study Hall backup.'); }
    e.target.value = '';
  };

  render();
  sync();
  setInterval(render, 30000); // re-check every 30s so windows open/close while the app is open
  document.addEventListener('visibilitychange', () => document.hidden || (render(), sync()));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

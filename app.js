// Clutch, a study hall tracker. Everything is saved on this phone (localStorage). No server, no account.
const WINDOW_HOURS = 4;      // you can log a study hall up to 4 hours after it ends
const EVENING_OPENS = '18:50'; // evening check unlocks at 6:50 PM (phone's local time)
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const at = (day, hhmm) => { const [h, m] = hhmm.split(':'); return new Date(day.getFullYear(), day.getMonth(), day.getDate(), +h, +m); };
const fmt = hhmm => { const [h, m] = hhmm.split(':'); return `${(+h % 12) || 12}:${m} ${+h < 12 ? 'AM' : 'PM'}`; };
const fmtDate = d => { const [y, m, day] = d.split('-'); return new Date(+y, m - 1, +day).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }; // Thu, Nov 26

// The study halls on a given day, with the time each one's logging window closes.
function slotsOn(day, schedule) {
  const midnight = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return schedule.filter(s => s.day === day.getDay()).map(s => {
    const end = at(day, s.end);
    return { key: `${ymd(day)} ${s.start}`, day, start: s.start, endStr: s.end, end,
             close: new Date(Math.min(end.getTime() + WINDOW_HOURS * 3600e3, midnight)) }; // same-day only
  }).sort((a, b) => a.end - b.end);
}

// Days off (breaks, canceled study halls): a list of { from, to } dates, from === to for one day.
// Older saves and the reminder script may not have the list yet, hence the `|| []`.
const isDayOff = (state, day) => { const d = ymd(day); return (state.daysOff || []).some(o => o.from <= d && d <= o.to); };
// The study halls that count on a given day: none on a day off.
const hallsOn = (state, day) => isDayOff(state, day) ? [] : slotsOn(day, state.schedule);

// Any study hall whose window closed without a log is saved as "missed" (counts as slacked).
function sweep(state, now) {
  const since = new Date(state.since);
  for (let d = new Date(since.getFullYear(), since.getMonth(), since.getDate()); d <= now; d.setDate(d.getDate() + 1))
    for (const s of hallsOn(state, d))
      if (s.close > since && s.close <= now && !state.logs[s.key]) state.logs[s.key] = { r: 'missed' };
}

// The evening check only ever asks about today: from 6:50 PM until midnight, never on a day off,
// and only until it's answered (yes, no, or 'none' = no homework tonight). Used by the app and the reminder server.
const eveDue = (state, now) => now >= at(now, EVENING_OPENS) && !isDayOff(state, now) && !(ymd(now) in (state.evening || {}));

const openSlot = (state, now) =>
  hallsOn(state, now).find(s => s.end <= now && now < s.close && !state.logs[s.key]);

function nextSlot(state, now) {
  for (let i = 0; i < 366; i++) { // a year ahead, so it can see past a long break
    const s = hallsOn(state, new Date(now.getFullYear(), now.getMonth(), now.getDate() + i)).find(s => s.end > now);
    if (s) return s;
  }
}

// Study halls in from..to that the app marked missed on its own ({ r: 'missed' } and nothing else, so no "at").
// Used when you add a day off in the past. Anything you logged yourself has "at" and is never included.
const autoMissed = (state, from, to) => Object.keys(state.logs).filter(k => {
  const l = state.logs[k], d = k.slice(0, 10);
  return from <= d && d <= to && l.r === 'missed' && Object.keys(l).length === 1;
});

const mondayOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7);

// Streak rules, replayed over every study hall you've ever logged (so old logs count too):
// Homework = +1. Slacked/missed = a freeze saves the streak if you have one, otherwise it breaks.
// You get +1 freeze every Monday, and +1 for Homework at the very next study hall after a break. Never more than 2.
function scoreboard(logs, now) {
  let streak = 0, best = 0, freezes = 0, week = null, last = null;
  const frozen = []; // study halls a freeze saved
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
    } else if (streak && freezes) { freezes--; last = 'frozen'; frozen.push(k); }
    else { last = streak ? 'broke' : 'miss'; streak = 0; }
  }
  newWeek(now);
  return { streak, best, freezes, last, frozen };
}

// This week's circles, one per study hall, Monday to Sunday. Used by the home screen and the share image.
function weekDots(state, now, frozen) {
  const monday = mondayOf(now), today = ymd(now), halls = [];
  for (let i = 0; i < 7; i++) halls.push(...slotsOn(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i), state.schedule));
  return halls.map(s => {
    const log = state.logs[s.key]; // a log you made before it became a day off still shows (and counts)
    const look = log ? (log.r === 'hw' ? 'hw' : frozen.includes(s.key) ? 'frozen' : 'slack')
      : isDayOff(state, s.day) ? 'off' : ymd(s.day) === today ? 'today' : '';
    return { s, look, letter: DAYS[s.day.getDay()][0] };
  });
}

// Sharing. Only the streak number, best, and week circles are ever shared: never notes, activities, or the schedule.
const APP_URL = 'https://leomoroz2011.github.io/studyhall/';
const shareText = n => `My study hall streak: ${n} 🔥 Track yours: ${APP_URL}`;
// Your best streak before the current one started (so a new record only counts on its first day).
// ponytail: replays the scoreboard per log, fine for a few hundred study halls
function oldBest(logs, now) {
  const keys = Object.keys(logs).sort();
  for (let j = keys.length; j > 0; j--) {
    const sb = scoreboard(Object.fromEntries(keys.slice(0, j - 1).map(k => [k, logs[k]])), now);
    if (!sb.streak) return sb.best;
  }
  return 0;
}
// Show the "Share streak" button? On 7, 14, 30, 50, 100, every 50 after, or the first day of a new best (7+). Once per value.
// Evening answer in History: true/false = old homework yes/no, 'none' = no homework at all that night.
const eveText = v => v === 'none' ? 'No homework that night' : `Old homework that night: ${v ? 'yes' : 'no'}`;
const isShareMilestone = (streak, prevBest, ui = {}) => streak > 0 && ui.shareShownFor !== streak &&
  ([7, 14, 30, 50, 100].includes(streak) || streak % 50 === 0 || (streak >= 7 && streak === prevBest + 1));

// Saved app data. Older saves lack the later additions, so they're filled in on load and on restore:
// activities = extra productive stuff per day, myActs = your own activity names, daysOff = breaks, nickname = from setup.
const withDefaults = s => ({ activities: {}, myActs: [], daysOff: [], nickname: '', ...s });
// Restore: the backup file's text → the app data, or null if it isn't a Clutch backup.
function readBackup(text) {
  const d = JSON.parse(text);
  return Array.isArray(d.schedule) && d.logs && d.evening ? withDefaults(d) : null;
}
// First-open setup only shows while no schedule is saved. A phone that has one never sees it.
const needsSetup = state => !state.schedule.length;
// A schedule line is bad if a time is missing (a half-typed time reads as missing) or the end isn't after the start.
const badTimes = s => !s.start || !s.end || s.end <= s.start;
// Saving a schedule (Settings or setup). It only counts from now on, so nothing before it becomes "missed".
function useSchedule(state, schedule, now) {
  if (state.schedule.length) sweep(state, now); // lock in misses from the old schedule first
  state.schedule = schedule;
  state.since = now.toISOString();
}
// What the reminder server gets: results only. Notes, activities, your own activity names and your nickname stay here.
function forServer(state) {
  const { activities, myActs, nickname, ...rest } = state;
  return { ...rest, logs: Object.fromEntries(Object.entries(state.logs).map(([k, v]) => [k, { r: v.r }])) };
}

if (typeof module !== 'undefined') module.exports = { ymd, at, slotsOn, isDayOff, eveDue, sweep, openSlot, nextSlot, autoMissed, scoreboard, weekDots, shareText, oldBest, isShareMilestone, eveText,
  withDefaults, readBackup, needsSetup, badTimes, useSchedule, forServer };

if (typeof document !== 'undefined') {
  const KEY = 'studyhall';
  const $ = s => document.querySelector(s);
  let state = withDefaults(JSON.parse(localStorage.getItem(KEY)) || { schedule: [], logs: {}, evening: {}, since: null });
  const save = () => localStorage.setItem(KEY, JSON.stringify(state));

  const CHECK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const SNOW = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3"/></svg>';

  function render() {
    const now = new Date(), today = ymd(now);
    const setUp = state.schedule.length > 0;
    if (setUp) { sweep(state, now); save(); }
    $('#main').hidden = !setUp || setupStep !== null || !$('#settings').hidden || !$('#history').hidden;
    if (!setUp && setupStep === null) startSetup();
    if (!setUp || setupStep !== null) return; // setup is showing

    // Streak
    const sb = scoreboard(state.logs, now);
    $('#s-streak').textContent = sb.streak;
    $('#s-freezes').textContent = `${sb.freezes} freeze${sb.freezes === 1 ? '' : 's'} left`;
    $('#s-best').textContent = sb.streak && sb.streak >= sb.best ? 'New record.' : `Best is ${sb.best}. ${sb.best - sb.streak + 1} more to beat it.`;
    $('#celebrate').hidden = sb.streak !== 7;
    $('#s-event').textContent = {
      comeback: 'Comeback bonus earned. +1 freeze.',
      frozen: 'A freeze saved your streak.',
      broke: 'Streak broke. Log Homework at your next study hall to earn a comeback freeze.',
    }[sb.last] || '';
    $('#s-event').className = sb.last === 'broke' ? 'sub' : 'ice';

    // Tap the streak to open History. Share button on milestone days (hidden for good once tapped or closed).
    $('#hero-tap').setAttribute('aria-label', `Streak ${sb.streak}. Open history`);
    const prev = sb.streak >= 7 && sb.streak === sb.best ? oldBest(state.logs, now) : 0;
    const reachedToday = Object.keys(state.logs).sort().pop()?.startsWith(today);
    $('#milestone').hidden = !(reachedToday && isShareMilestone(sb.streak, prev, readUI()));

    // This week: one circle per study hall, Monday to Sunday
    const monday = mondayOf(now), dots = weekDots(state, now, sb.frozen), halls = dots.map(d => d.s);
    $('#week-dots').innerHTML = dots.map(({ look, letter }) =>
      `<div class="dot ${look}"><i>${{ hw: CHECK, frozen: SNOW }[look] || ''}</i><span class="label">${letter}</span></div>`).join('');
    const counted = halls.filter(s => state.logs[s.key] || !isDayOff(state, s.day));
    $('#s-halls').textContent = `${counted.filter(s => state.logs[s.key]?.r === 'hw').length} of ${counted.length} halls`;
    const acts = Object.entries(state.activities).filter(([d]) => d >= ymd(monday)).reduce((n, [, a]) => n + a.did.length, 0);
    $('#s-acts').textContent = `${acts} ${acts === 1 ? 'activity' : 'activities'} this week`;

    // Bottom card: log a study hall, else "anything else productive?", else the evening check, else "nothing to do"
    const slot = openSlot(state, now);
    const loggedToday = Object.entries(state.logs).some(([k, l]) => k.startsWith(today) && l.at); // you logged it (not auto-missed)
    const act = !slot && loggedToday && !state.activities[today];
    const unanswered = state.evening[today] === undefined, eveOpen = now >= at(now, EVENING_OPENS);
    const eve = !slot && !act && eveDue(state, now);
    $('#log-card').hidden = !slot;
    $('#act-card').hidden = !act;
    if (act) renderChips();
    $('#eve-card').hidden = !eve;
    $('#done-card').hidden = !!slot || act || eve;
    if (slot) $('#log-time').textContent = `${fmt(slot.start).replace(fmt(slot.endStr).slice(-3), '')}–${fmt(slot.endStr)}`; // 7:30–9:30 PM
    else if (!eve && !act) {
      const n = nextSlot(state, now), hallLater = n && ymd(n.day) === today, eveLater = !eveOpen && unanswered;
      const soon = n && n.day - now < 6 * 864e5; // within the week: "Mon", further away (after a break): "Mon, Jan 5"
      const next = n && `Next study hall: ${hallLater ? 'today' : soon ? DAYS[n.day.getDay()] : fmtDate(ymd(n.day))} ${fmt(n.start)}–${fmt(n.endStr)}.`;
      const off = isDayOff(state, now);
      $('#done-title').textContent = off ? 'Day off' : hallLater || eveLater ? 'Nothing to log yet' : 'All logged for today';
      $('#done-msg').textContent = off ? next || '' : [eveLater && `Evening check opens at ${fmt(EVENING_OPENS)}.`, next].filter(Boolean).join(' ');
    }
    prepCard();
  }

  function saveLog(result, note) {
    const now = new Date(), slot = openSlot(state, now);
    if (!slot) { alert('Too late: this study hall can’t be logged anymore.'); return render(); }
    state.logs[slot.key] = { r: result, note, at: now.toISOString() };
    save();
    sync();
    $('#hw-note').value = '';
    render();
  }

  $('#btn-slack').onclick = () => saveLog('slack');
  $('#btn-hw').onclick = () => {
    const note = $('#hw-note').value.trim();
    if (!note) { $('#hw-error').hidden = false; $('#hw-note').focus(); return; }
    $('#hw-error').hidden = true;
    saveLog('hw', note);
  };
  // "Anything else productive today?" Tap activities, add details, save (or skip).
  const picked = new Set();
  function renderChips() {
    $('#chips').innerHTML = '';
    for (const name of ['Workout', 'Business', 'App', 'Reading', ...state.myActs]) {
      const chip = document.createElement('button');
      chip.textContent = name;
      chip.className = picked.has(name) ? 'on' : '';
      chip.onclick = () => { picked.has(name) ? picked.delete(name) : picked.add(name); renderChips(); };
      $('#chips').append(chip);
    }
    const add = document.createElement('button');
    add.textContent = '+ Your own';
    add.onclick = () => {
      const name = prompt('Name it (e.g. Guitar, Running):')?.trim();
      if (!name) return;
      if (!state.myActs.includes(name)) { state.myActs.push(name); save(); }
      picked.add(name);
      renderChips();
    };
    $('#chips').append(add);
  }
  const saveActs = did => {
    state.activities[ymd(new Date())] = { did, note: did.length ? $('#act-note').value.trim() : '' };
    save();
    picked.clear();
    $('#act-note').value = '';
    render();
  };
  $('#act-save').onclick = () => saveActs([...picked]);
  $('#act-skip').onclick = () => saveActs([]);

  // Talk instead of typing (iPhone may block this in home-screen apps; then the keyboard mic still works)
  const Speech = window.SpeechRecognition || window.webkitSpeechRecognition;
  for (const btn of document.querySelectorAll('.mic')) {
    const box = btn.previousElementSibling;
    btn.onclick = () => {
      if (!Speech) return alert('Voice typing isn’t available here. Tap the mic on your keyboard instead (next to the space bar).');
      if (btn.rec) return btn.rec.stop(); // tap again to stop
      const rec = btn.rec = new Speech(), before = box.value.trim();
      rec.lang = 'en-US';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = e => { box.value = [before, [...e.results].map(r => r[0].transcript).join('')].filter(Boolean).join(' '); };
      rec.onerror = e => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
          alert('Your iPhone blocked voice typing here. Tap the mic on your keyboard instead (next to the space bar).');
      };
      rec.onend = () => { btn.rec = null; btn.classList.remove('on'); };
      btn.classList.add('on');
      rec.start();
    };
  }

  // History: every day, newest first
  const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  function openHistory() {
    prepCard();
    const frozen = scoreboard(state.logs, new Date()).frozen;
    const days = [...new Set([...Object.keys(state.logs).map(k => k.slice(0, 10)), ...Object.keys(state.activities), ...Object.keys(state.evening)])].sort().reverse();
    $('#hist-list').innerHTML = days.map(d => {
      const halls = Object.entries(state.logs).filter(([k]) => k.startsWith(d)).map(([k, l]) =>
        l.r === 'hw' ? `<p><b class="hw">Homework</b>${l.note ? ` — ${esc(l.note)}` : ''}</p>`
        : `<p><b class="${frozen.includes(k) ? 'frozen' : ''}">${l.r === 'slack' ? 'Slacked' : 'Missed'}${frozen.includes(k) ? ' (freeze used)' : ''}</b></p>`);
      const a = state.activities[d];
      const extra = a?.did.length ? `<p>${a.did.map(esc).join(', ')}${a.note ? ` — ${esc(a.note)}` : ''}</p>` : '';
      const eve = d in state.evening ? `<p class="sub">${eveText(state.evening[d])}</p>` : '';
      return `<div class="card"><span class="label">${fmtDate(d).toUpperCase()}</span>${halls.join('')}${extra}${eve}</div>`;
    }).join('') || '<p class="sub">Nothing logged yet.</p>';
    $('#history').hidden = false;
    $('#main').hidden = true;
    scrollTo(0, 0);
  }
  $('#hero-tap').onclick = $('#week-card').onclick = openHistory; // the "History ›" label is inside the week card
  $('#hero-tap').onkeydown = e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openHistory(); } }; // not when the share button inside has focus
  $('#hist-done').onclick = () => { $('#history').hidden = true; render(); };

  const saveEve = v => { state.evening[ymd(new Date())] = v; save(); render(); sync(); };
  $('#eve-yes').onclick = () => saveEve(true);
  $('#eve-no').onclick = () => saveEve(false);
  $('#eve-none').onclick = () => saveEve('none');

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
    prepCard();
    renderDaysOff();
    $('#rows').innerHTML = '';
    (state.schedule.length ? state.schedule : [undefined]).forEach(addRow);
    $('#settings').hidden = false;
    $('#main').hidden = true;
    $('#btn-cancel').hidden = !state.schedule.length;
    scrollTo(0, 0);
  }
  $('#btn-gear').onclick = showSettings;
  // New line copies the times from the last line and moves to the next day.
  $('#btn-add').onclick = () => {
    const last = [...document.querySelectorAll('#rows .row')].pop();
    if (!last) return addRow();
    const [sel, start, end] = last.querySelectorAll('select, input');
    addRow({ day: (+sel.value + 1) % 7, start: start.value, end: end.value });
  };
  $('#btn-cancel').onclick = () => { $('#settings').hidden = true; render(); };
  $('#btn-save-sched').onclick = () => {
    const rows = [...document.querySelectorAll('#rows .row')];
    const schedule = rows.map(r => {
      const [sel, start, end] = r.querySelectorAll('select, input');
      return { day: +sel.value, start: start.value, end: end.value };
    });
    if (!schedule.length) return alert('Add at least one study hall.');
    // A half-typed time (e.g. AM/PM not picked) reads as empty, so point at the exact line.
    const bad = schedule.map(badTimes);
    rows.forEach((r, i) => r.classList.toggle('bad', bad[i]));
    const badDays = schedule.filter((s, i) => bad[i]).map(s => DAYS[s.day]);
    if (badDays.length) return alert(`Check the red line(s): ${badDays.join(', ')}.\n\n${TIME_HELP}`);
    useSchedule(state, schedule, new Date());
    save();
    $('#settings').hidden = true;
    render();
    sync();
  };

  // Days off: current and upcoming ones are listed (past ones stay saved, just not shown)
  function renderDaysOff() {
    const today = ymd(new Date());
    $('#off-list').innerHTML = '';
    for (const o of state.daysOff.filter(o => o.to >= today).sort((a, b) => a.from < b.from ? -1 : 1)) {
      const row = document.createElement('div');
      row.className = 'row between';
      row.innerHTML = `<span>${fmtDate(o.from)}${o.to !== o.from ? ` – ${fmtDate(o.to)}` : ''}</span><button class="x" aria-label="Remove">✕</button>`;
      row.querySelector('.x').onclick = () => {
        if (o.from < today && !confirm('Study halls on past dates in this range will count as missed again.')) return;
        state.daysOff = state.daysOff.filter(x => x !== o); // sweep() marks those past ones missed on the next check
        save(); renderDaysOff(); render(); sync();
      };
      $('#off-list').append(row);
    }
  }
  $('#btn-add-off').onclick = () => {
    const from = $('#off-from').value, to = $('#off-to').value || from;
    if (!from) return alert('Pick the first day off (From).');
    if (to < from) return alert('The "To" date can’t be before the "From" date.');
    state.daysOff.push({ from, to });
    // If it's in the past, the app may already have marked those study halls missed. Offer to take that back.
    const marks = autoMissed(state, from, to);
    if (marks.length && confirm(`${marks.length} study hall${marks.length === 1 ? ' in these dates was' : 's in these dates were'} marked missed. Remove ${marks.length === 1 ? 'that mark' : 'those marks'}?`))
      for (const k of marks) delete state.logs[k];
    save();
    $('#off-from').value = $('#off-to').value = '';
    renderDaysOff(); render(); sync();
  };

  // Reminders: one tap signs this phone up with Clutch's reminder server (worker/index.js), which sends them.
  const SERVER = 'https://clutch.clutch-reminders.workers.dev';
  const PUSH_KEY = 'BOKT6BaTQ5jhqn0oVO0jdNCnnmr6AhZQhwb-eb3BQHnXxYzTDdZ6Fd8LxP-bYcvBF6vG7YGAIOMEZW0FPYHwypk';
  const myId = () => localStorage.getItem('clutchId') || (localStorage.setItem('clutchId', crypto.randomUUID()), localStorage.getItem('clutchId'));
  const post = (path, data) => fetch(SERVER + path, { method: 'POST', body: JSON.stringify({ id: myId(), ...data }) })
    .then(async r => { if (!r.ok) throw new Error(await r.text()); });
  const showOn = on => {
    $('#btn-notify').textContent = on ? 'Reminders are on ✓' : 'Turn on reminders';
    $('#btn-test').hidden = !on;
  };
  // iPhone only allows asking for notifications right at the tap, so everything else is ready beforehand.
  const pushKey = Uint8Array.from(atob(PUSH_KEY.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  let reg = null, oldSub = null;
  navigator.serviceWorker?.ready.then(async r => { reg = r; oldSub = await r.pushManager?.getSubscription(); });
  $('#btn-notify').onclick = async () => {
    if (!('PushManager' in window)) return alert('Open Clutch from your home-screen icon first, then tap this again.');
    if (!reg) return alert('Clutch is still loading. Try again in a second.');
    try {
      if (oldSub) await oldSub.unsubscribe(); // start fresh (permission was already given, so the wait is fine)
      // first thing after the tap: this shows the "Allow notifications?" question if needed
      oldSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushKey });
      localStorage.setItem('reminders', 'on');
      if (!await sync()) return alert($('#sync-status').textContent);
      showOn(true);
      await post('/test', {});
      alert('Reminders are on. You should get a test notification now.');
    } catch (err) {
      alert(Notification.permission === 'denied' ? 'Notifications are off. Turn them on in Settings → Notifications → Clutch.'
        : `Couldn’t turn on reminders: ${err.message}`);
    }
  };

  $('#btn-test').onclick = () => post('/test', {}).then(() => alert('Sent. It should show up in a few seconds.'), err => alert(`Couldn’t send: ${err.message}`));
  showOn(localStorage.getItem('reminders') === 'on');
  localStorage.removeItem('ghToken'); // old GitHub key from before the reminder server, not needed anymore
  localStorage.removeItem('pushSent');

  // Sends your progress to the reminder server, so reminders know your real streak, when study hall ends,
  // and whether you've opened the app. Notes, activities, your own activity names and your nickname stay on your phone.
  async function sync() {
    if (localStorage.getItem('reminders') !== 'on') return;
    try {
      const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
      if (!sub) { localStorage.removeItem('reminders'); showOn(false); return; } // notifications were turned off
      await post('/sync', { tz: Intl.DateTimeFormat().resolvedOptions().timeZone, sub, state: { ...forServer(state), lastOpen: new Date().toISOString() } });
      $('#sync-status').textContent = `Synced ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
      return true;
    } catch (err) { $('#sync-status').textContent = `Couldn’t sync: ${err.message}`; }
  }

  // Backup
  $('#btn-export').onclick = async () => {
    const file = new File([JSON.stringify(state, null, 2)], `clutch-backup-${ymd(new Date())}.json`, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) return navigator.share({ files: [file] }).catch(() => {});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
  };
  $('#btn-import').onclick = () => $('#import-file').click();
  $('#import-file').onchange = async e => {
    try {
      const data = readBackup(await e.target.files[0].text());
      if (!data) throw 0;
      if (!confirm('Replace everything in the app with this backup?')) return;
      state = data;
      save();
      $('#settings').hidden = true; // back to the home screen (also after a fresh re-install, where Done is hidden)
      if (!needsSetup(state)) { setupStep = null; $('#setup').hidden = true; } // restored from the setup screen: skip the rest
      render();
      sync();
    } catch { alert('That file isn’t a Clutch backup.'); }
    e.target.value = '';
  };

  const toast = msg => {
    $('#toast').textContent = msg;
    $('#toast').hidden = false;
    setTimeout(() => { $('#toast').hidden = true; }, 2000);
  };
  // Share sheet with plain text + the app link (no encoding). No share sheet → copy both and say so.
  // Never start the text with "Word:": newer iPhones read that as the start of a link and turn every space into %20.
  const shareLine = (text, copied) => {
    const copy = () => navigator.clipboard.writeText(`${text} ${APP_URL}`).then(() => toast(copied));
    if (!navigator.share) return copy();
    navigator.share({ text, url: APP_URL }).catch(err => err.name === 'AbortError' || copy()); // canceled = do nothing
  };
  // Invite: only the link and a how-to line, never any of your data
  const invite = () => shareLine('Clutch — tracks if you actually use study hall. Open this link in Safari, tap Share, then Add to Home Screen.',
    'Link copied. Paste it in a text to a friend.');
  $('#btn-share').onclick = invite;
  // Day 7 banner
  $('#brag').onclick = e => {
    e.stopPropagation(); // the banner sits on the streak, which opens History
    shareLine("I'm on a 7 study hall streak on Clutch. Bet you can't do it.", 'Copied!');
  };

  // Share streak: a 1080×1920 picture of your streak. It's drawn ahead of time, because iPhone only allows
  // sharing right when you tap, so nothing can be awaited between the tap and navigator.share().
  const UI_KEY = 'clutch_ui'; // screen-only settings, kept apart from your data ("studyhall")
  const readUI = () => { try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch { return {}; } };
  const FLAME = '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="82" viewBox="22 10 56 82"><path d="M50 12 C59 30 76 40 76 62 C76 79 64 90 50 90 C36 90 24 79 24 62 C24 48 32 40 38 32 C39 43 44 49 50 51 C46 38 45 25 50 12 Z" fill="#FF5A1F"/></svg>';
  let card = null, cardSig = '', cardJob = Promise.resolve(null);
  function prepCard() {
    const now = new Date(), sb = scoreboard(state.logs, now);
    const info = { streak: sb.streak, best: sb.best, dots: weekDots(state, now, sb.frozen).map(({ look, letter }) => ({ look, letter })) };
    const sig = JSON.stringify(info);
    if (sig === cardSig) return cardJob;
    cardSig = sig; card = null;
    return cardJob = drawCard(info).then(f => { if (cardSig === sig) card = f; return f; }).catch(() => null);
  }
  async function drawCard({ streak, best, dots }) {
    await Promise.race([Promise.all(['800 440px "Bricolage Grotesque"', '40px "Instrument Sans"', '40px "DM Mono"'].map(f => document.fonts.load(f))),
      new Promise(ok => setTimeout(ok, 3000))]);
    const flame = new Image();
    flame.src = `data:image/svg+xml,${encodeURIComponent(FLAME)}`;
    await flame.decode();
    const c = document.createElement('canvas');
    c.width = 1080; c.height = 1920;
    const g = c.getContext('2d');
    g.fillStyle = '#141312';
    g.fillRect(0, 0, 1080, 1920);
    g.textAlign = 'center';
    const text = (t, font, color, y, spacing = 0) => { g.font = font; g.fillStyle = color; g.letterSpacing = `${spacing}px`; g.fillText(t, 540, y); };
    g.drawImage(flame, 540 - 41, 170, 82, 120);
    text('CLUTCH', '40px "DM Mono"', '#A8A29A', 350, 8);
    // Big number + 🔥, shrunk to fit if it's 3+ digits
    const num = String(streak), fire = ' 🔥';
    g.letterSpacing = '0px';
    g.font = '800 440px "Bricolage Grotesque"'; const w1 = g.measureText(num).width;
    g.font = '300px "Instrument Sans"'; const w2 = g.measureText(fire).width;
    const k = Math.min(1, 888 / (w1 + w2));
    g.textAlign = 'left';
    g.fillStyle = '#F6F1E7';
    g.font = `800 ${440 * k}px "Bricolage Grotesque"`; g.fillText(num, 540 - (w1 + w2) * k / 2, 960);
    g.font = `${300 * k}px "Instrument Sans"`; g.fillText(fire, 540 - (w1 + w2) * k / 2 + w1 * k, 960);
    g.textAlign = 'center';
    text('STUDY HALL STREAK', '44px "DM Mono"', '#A8A29A', 1090, 6);
    text(`Best: ${best}`, '44px "Instrument Sans"', '#A8A29A', 1180);
    // This week's circles, same colors as the app
    const D = Math.min(96, 888 / Math.max(1, dots.length * 1.3)), gap = D * 30 / 96, x0 = 540 - (dots.length * D + (dots.length - 1) * gap) / 2;
    dots.forEach(({ look, letter }, i) => {
      const cx = x0 + D / 2 + i * (D + gap), cy = 1330;
      g.beginPath(); g.arc(cx, cy, D / 2 - (look === 'hw' || look === 'frozen' || look === 'slack' ? 0 : 2), 0, 2 * Math.PI);
      if (look === 'hw' || look === 'frozen' || look === 'slack') { g.fillStyle = { hw: '#FF5A1F', frozen: '#2B3A4A', slack: '#3A3733' }[look]; g.fill(); }
      else { g.setLineDash(look === 'off' ? [12, 10] : []); g.lineWidth = 4; g.strokeStyle = '#3A3733'; g.stroke(); g.setLineDash([]); }
      if (look === 'hw' || look === 'frozen') { // same check / snowflake as the app (24×24 icons, drawn at half the circle)
        g.save(); g.translate(cx - D / 4, cy - D / 4); g.scale(D / 48, D / 48);
        g.lineWidth = look === 'hw' ? 3.5 : 2; g.lineCap = g.lineJoin = 'round'; g.strokeStyle = look === 'hw' ? '#141312' : '#9CC4F2';
        g.stroke(new Path2D(look === 'hw' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7M9 4l3 3 3-3M9 20l3-3 3 3'));
        g.restore();
      }
      g.font = '28px "DM Mono"'; g.fillStyle = '#A8A29A'; g.fillText(letter, cx, cy + D / 2 + 50);
    });
    const line = streak >= 30 ? 'Try to keep up.' : streak >= 7 ? 'Yes, I actually did my homework.' : streak ? 'Small streak. Big ego.' : 'Rebuilding. Don’t look at me.';
    text(line, '40px "Instrument Sans"', '#F6F1E7', 1560);
    text('Track yours:', '34px "Instrument Sans"', '#A8A29A', 1720);
    text(APP_URL.replace('https://', '').replace(/\/$/, ''), '34px "DM Mono"', '#FF5A1F', 1775);
    const blob = await new Promise(ok => c.toBlob(ok, 'image/png'));
    return new File([blob], 'clutch-streak.png', { type: 'image/png' });
  }
  let sharing = false; // ignore extra taps while the share sheet is open
  function shareStreak() {
    if (sharing) return;
    if (!navigator.share) return navigator.clipboard.writeText(shareText(scoreboard(state.logs, new Date()).streak)).then(() => toast('Copied. Paste it anywhere.'));
    if (!card || !navigator.canShare?.({ files: [card] })) return showCard();
    sharing = true;
    navigator.share({ files: [card] }) // the picture only: adding text or a link makes some apps drop the picture
      .catch(err => err.name === 'AbortError' || err.name === 'InvalidStateError' || showCard()) // canceled = do nothing
      .finally(() => { sharing = false; });
  }
  // Fallback: show the picture full-screen so you can press and hold to save it
  async function showCard() {
    const file = card || await prepCard();
    if (!file) return alert('Couldn’t make the picture. Try again in a second.');
    $('#card-img').src = URL.createObjectURL(file);
    $('#card-view').hidden = false;
  }
  $('#card-done').onclick = () => { URL.revokeObjectURL($('#card-img').src); $('#card-img').removeAttribute('src'); $('#card-view').hidden = true; };
  const seenMilestone = () => {
    localStorage.setItem(UI_KEY, JSON.stringify({ ...readUI(), shareShownFor: scoreboard(state.logs, new Date()).streak }));
    $('#milestone').hidden = true;
  };
  $('#ms-share').onclick = () => { shareStreak(); seenMilestone(); }; // share first: it has to start right at the tap
  $('#ms-hide').onclick = seenMilestone;
  $('#hist-share').onclick = $('#btn-share-streak').onclick = shareStreak;

  // First-open setup. Only while no schedule is saved (render() starts it), so a phone that's set up never sees it.
  // Step 0 (iPhone/iPad Safari only): add to home screen first, with no way past it, because Safari and the
  // home-screen app keep separate data. Setting up in Safari would leave everything stuck in that tab.
  const TIME_HELP = 'Tap each time and make sure the hour, minutes AND AM/PM are all filled in. The end has to be after the start.';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let setupStep = null; // null = not in setup, -1 = "add to home screen", 0+ = position in steps()
  const steps = () => ['name', 'sched', 'rules', ...('PushManager' in window ? ['remind'] : []), 'ready']; // reminders need a device that can get them
  function startSetup() {
    $('#setup').hidden = false;
    $('#settings').hidden = $('#history').hidden = true;
    if (ios && !standalone) { setupStep = -1; $('#install').hidden = false; $('#wizard').hidden = true; return; }
    showStep(0);
  }
  function showStep(i) {
    const list = steps(), name = list[i];
    setupStep = i;
    $('#install').hidden = true;
    $('#wizard').hidden = false;
    for (const s of document.querySelectorAll('.step')) s.hidden = s.dataset.step !== name;
    $('#st-back').style.visibility = i ? 'visible' : 'hidden';
    $('#st-count').textContent = `STEP ${i + 1} OF ${list.length}`;
    $('#st-bar').style.width = `${(i + 1) / list.length * 100}%`;
    if (name === 'name') $('#st-name').value = state.nickname;
    if (name === 'ready') {
      const now = new Date(), n = nextSlot(state, now);
      $('#st-hi').textContent = state.nickname ? `You're set, ${state.nickname}.` : "You're set.";
      $('#st-first').textContent = `Your streak starts at your next study hall: ${n ? `${ymd(n.day) === ymd(now) ? 'today' : DAYS[n.day.getDay()]} at ${fmt(n.start)}` : 'see your schedule'}. You've got 1 freeze to start.`;
    }
    scrollTo(0, 0);
  }
  $('#st-back').onclick = () => showStep(setupStep - 1);

  // Step: nickname (optional)
  $('#st-name-next').onclick = () => { state.nickname = $('#st-name').value.trim(); save(); showStep(setupStep + 1); };
  $('#st-restore').onclick = () => $('#import-file').click(); // the normal restore; it closes setup if the backup has a schedule

  // Step: schedule. Day circles M–S, one start/end for all, or one row per day.
  const WEEK = [1, 2, 3, 4, 5, 6, 0];
  const onDays = new Set([1, 2, 3, 4, 5]);
  let perDay = false;
  const rowTimes = () => Object.fromEntries([...document.querySelectorAll('#st-rows .row')].map(r => {
    const [start, end] = r.querySelectorAll('input');
    return [r.dataset.day, { start: start.value, end: end.value }];
  }));
  function drawDays() {
    const kept = rowTimes(); // keep what's typed in the rows when a day is switched on/off
    $('#st-days').innerHTML = '';
    for (const d of WEEK) {
      const b = document.createElement('button');
      b.textContent = DAYS[d][0];
      b.className = onDays.has(d) ? 'on' : '';
      b.setAttribute('aria-label', DAYS[d]);
      b.setAttribute('aria-pressed', onDays.has(d));
      b.onclick = () => { onDays.has(d) ? onDays.delete(d) : onDays.add(d); drawDays(); };
      $('#st-days').append(b);
    }
    $('#st-same').hidden = perDay;
    $('#st-perday').hidden = perDay;
    $('#st-rows').innerHTML = '';
    if (perDay) for (const d of WEEK.filter(d => onDays.has(d))) {
      const t = kept[d] || { start: $('#st-start').value, end: $('#st-end').value };
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.day = d;
      row.innerHTML = `<span class="label" style="width:36px">${DAYS[d].toUpperCase()}</span><input type="time" aria-label="${DAYS[d]} start"><span>to</span><input type="time" aria-label="${DAYS[d]} end">`;
      const [start, end] = row.querySelectorAll('input');
      start.value = t.start; end.value = t.end;
      $('#st-rows').append(row);
    }
  }
  $('#st-perday').onclick = () => { perDay = true; drawDays(); };
  $('#st-sched-next').onclick = () => {
    const err = msg => { $('#st-err').textContent = msg; $('#st-err').hidden = !msg; };
    const days = WEEK.filter(d => onDays.has(d)), rows = rowTimes();
    if (!days.length) return err('Pick at least one day.');
    const schedule = days.map(d => ({ day: d, ...(perDay ? rows[d] : { start: $('#st-start').value, end: $('#st-end').value }) }));
    const bad = schedule.map(badTimes);
    $('#st-same').classList.toggle('bad', !perDay && bad.some(Boolean));
    for (const r of document.querySelectorAll('#st-rows .row')) r.classList.toggle('bad', bad[days.indexOf(+r.dataset.day)]);
    if (bad.some(Boolean)) return err(perDay ? `Check the red line(s). ${TIME_HELP}` : TIME_HELP);
    err('');
    useSchedule(state, schedule, new Date()); // exactly like Save schedule in Settings
    save();
    sync();
    showStep(setupStep + 1);
  };
  drawDays();

  $('#st-rules-next').onclick = () => showStep(setupStep + 1);
  $('#st-remind-on').onclick = async () => { await $('#btn-notify').onclick(); showStep(setupStep + 1); };
  $('#st-remind-skip').onclick = () => showStep(setupStep + 1);
  $('#st-go').onclick = () => { setupStep = null; $('#setup').hidden = true; render(); };
  $('#st-invite').onclick = invite;

  render();
  sync();
  setInterval(render, 30000); // re-check every 30s so windows open/close while the app is open
  document.addEventListener('visibilitychange', () => document.hidden || (render(), sync()));
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
}

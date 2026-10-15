// The reminder rules: is a reminder due for this person right now? No sending here, so tests and the dry run use it too.
import app from '../app.js';
import msgs from './messages.cjs';

const { ymd, at, sweep, openSlot, scoreboard, isDayOff, eveDue } = app;
const NIGHT = '22:00'; // overnight quiet hours start (until 7 AM)
const MAX_PER_DAY = 2;

// The person's own clock time (their phone's time zone, daylight saving included). Workers run in UTC,
// so this Date's "local" fields are their local time.
export function wall(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d).map(x => [x.type, +x.value]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

// Returns { text, why }: text is the reminder to send (null = send nothing), why says the reason.
// Rules: only about today, nothing on a day off, quiet 7–9:30 PM (phone away) and 10 PM–7 AM, at most 2 a day
// (one study hall + one evening), and a pause after 3 ignored days. `realNow` is checked right before each send.
export function check(user, log, realNow) {
  const now = wall(user.tz, realNow), today = ymd(now);
  // a copy: sweep() adds "missed" marks, which only matter for the streak in the message (never saved)
  const st = { ...user.state, logs: { ...user.state.logs }, since: wall(user.tz, new Date(user.state.since || 0)).toISOString() };
  if (log.day !== today) Object.assign(log, { day: today, sent: [] });
  log.days ||= []; // days a reminder was sent
  log.last ||= {}; // last message used per type, so it never repeats back-to-back
  const quiet = why => ({ text: null, why });

  if (isDayOff(st, now)) return quiet('day off');
  if (now < at(now, '07:00') || now >= at(now, NIGHT)) return quiet('overnight quiet hours (10 PM–7 AM)');
  if (now >= at(now, '19:00') && now < at(now, '21:30')) return quiet('quiet hours (7–9:30 PM, phone away)');
  if (log.sent.length >= MAX_PER_DAY) return quiet(`already sent ${MAX_PER_DAY} today`);

  if (st.schedule.length && user.state.since) sweep(st, now);
  const sh = !log.sent.some(k => k !== 'eve') && openSlot(st, now);
  let due = null;
  if (eveDue(st, now) && now < at(now, '19:50') && !log.sent.includes('eve')) due = 'eve';
  else if (sh) due = sh.key;
  if (!due) return quiet('nothing due (no study hall just ended, and no unanswered evening check right now)');

  // Ignored 3 days in a row (reminders sent, app not opened) → one last message, then pause until they open the app.
  const opened = new Date(st.lastOpen || 0);
  if (log.paused && opened > new Date(log.paused)) { delete log.paused; log.days = []; }
  if (log.paused) return quiet('paused: 3 days of reminders ignored, waiting for the app to be opened');
  log.days = log.days.filter(d => d > ymd(wall(user.tz, opened)));
  const chill = log.days.length >= 3 && !log.days.includes(today);

  let text;
  if (chill) { text = msgs.chill; log.paused = realNow.toISOString(); }
  else {
    const sb = scoreboard(st.logs, now), type = due === 'eve' ? 'eve' : 'sh';
    const pool = sb.streak ? type : type === 'sh' && sb.last === 'broke' ? 'shBack' : `${type}0`;
    let i;
    do i = Math.floor(Math.random() * msgs[pool].length); while (msgs[pool].length > 1 && i === log.last[pool]);
    log.last[pool] = i;
    text = msgs[pool][i](sb.streak, sb.freezes);
    log.days.includes(today) || log.days.push(today);
  }
  log.sent.push(due);
  return { text, why: chill ? 'last message before pausing (3 ignored days)' : due === 'eve' ? 'evening check not answered yet' : `study hall ${due} just ended and isn't logged` };
}

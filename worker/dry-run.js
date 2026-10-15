// Dry run: prints what the reminder server WOULD send at a pretend date and time, and why. Never sends anything.
// Run from GitHub (Actions → "Reminder dry run"), or here: node worker/dry-run.js "2026-10-16 18:55"
// Uses the schedule in the STATE variable if there is one, otherwise a sample schedule.
import { wall, check } from './check.js';
process.env.TZ = 'UTC'; // same as the reminder server (wall() relies on it)

const [when, tz = 'America/Los_Angeles', dayOff = 'false', evening = 'unanswered'] = process.argv.slice(2);
const m = /^(\d{4})-(\d\d)-(\d\d) (\d\d?):(\d\d)$/.exec(when || '');
if (!m) { console.error('Write the time like 2026-10-16 18:55 (24-hour clock).'); process.exit(1); }

// "6:55 PM in that time zone" → the real moment (daylight saving included)
const guess = Date.UTC(m[1], m[2] - 1, m[3], m[4], m[5]);
const now = new Date(2 * guess - wall(tz, new Date(guess)).getTime());
const today = `${m[1]}-${m[2]}-${m[3]}`;

const state = process.env.STATE ? JSON.parse(process.env.STATE)
  : { schedule: [1, 2, 3, 4, 5].map(day => ({ day, start: '13:00', end: '13:50' })), logs: {}, evening: {}, since: '2026-09-01T00:00:00Z' };
state.daysOff = dayOff === 'true' ? [{ from: today, to: today }] : [];
state.evening = evening === 'unanswered' ? {} : { [today]: { yes: true, no: false, none: 'none' }[evening] };
state.lastOpen = now.toISOString(); // pretend the app was opened recently, so the "3 ignored days" pause doesn't kick in

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
console.log(`Pretend time: ${when} (${tz}). Day off: ${dayOff}. Evening check: ${evening}.`);
console.log(`Schedule used: ${state.schedule.map(s => `${DAYS[s.day]} ${s.start}–${s.end}`).join(', ')}`);
const { text, why } = check({ tz, state }, {}, now);
console.log(text ? `WOULD SEND: "${text}"\nWhy: ${why}` : `WOULD STAY QUIET.\nWhy: ${why}`);
console.log('(Dry run: nothing was sent.)');

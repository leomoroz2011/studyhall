// Checks the reminder server's rules. Run with: node test.js (inside the worker folder)
import assert from 'assert';
process.env.TZ = 'UTC'; // Cloudflare runs in UTC; wall() handles each person's time zone
import { wall, check } from './index.js';

// Times are real instants; the person is in Denver (UTC-6 in October)
const T = s => new Date(`${s}-06:00`);
assert.equal(wall('America/Denver', T('2026-10-01T18:55:00')).toISOString(), '2026-10-01T18:55:00.000Z');
assert.equal(wall('America/New_York', T('2026-10-01T18:55:00')).getUTCHours(), 20);

const user = (extra = {}) => ({ tz: 'America/Denver', sub: {}, state: {
  schedule: [4].map(day => ({ day, start: '19:30', end: '21:30' })), // Thursdays (Oct 1 2026 is a Thursday)
  logs: { '2026-09-24 19:30': { r: 'hw' } }, evening: {}, since: '2026-09-01T00:00:00Z', lastOpen: T('2026-10-01T12:00:00').toISOString(), ...extra } });

// Evening check at 6:55 PM, once
let log = {};
assert(/\b1\b/.test(check(user(), log, T('2026-10-01T18:55:00')))); // streak of 1 is in the message
assert.equal(check(user(), log, T('2026-10-01T19:00:00')), null);
// Not if already answered tonight
assert.equal(check(user({ evening: { '2026-10-01': false } }), {}, T('2026-10-01T18:55:00')), null);
// Study hall reminder right after it ends (9:35 PM), once
log = { day: '2026-10-01', sent: ['eve'] };
assert(check(user(), log, T('2026-10-01T21:35:00')));
assert.equal(check(user(), log, T('2026-10-01T21:40:00')), null);
// Not if already logged
assert.equal(check(user({ logs: { '2026-10-01 19:30': { r: 'hw' } } }), { day: '2026-10-01', sent: ['eve'] }, T('2026-10-01T21:35:00')), null);
// Not on a day off
assert.equal(check(user({ daysOff: [{ from: '2026-10-01', to: '2026-10-01' }] }), { day: '2026-10-01', sent: ['eve'] }, T('2026-10-01T21:35:00')), null);
// Quiet hours: nothing at 10:05 PM even with study hall unlogged
assert.equal(check(user({ schedule: [{ day: 4, start: '20:00', end: '21:50' }] }), { day: '2026-10-01', sent: ['eve'] }, T('2026-10-01T22:05:00')), null);
// Someone in New York gets their evening check at THEIR 6:55 PM
const ny = { ...user(), tz: 'America/New_York' };
assert(check(ny, {}, new Date('2026-10-01T18:55:00-04:00')));
assert.equal(check(ny, {}, T('2026-10-01T18:55:00')), null); // 8:55 PM in New York
// Ignored 3 days → the "I'll stop texting" message, then nothing until they open the app
log = { day: '2026-09-30', sent: [], days: ['2026-09-28', '2026-09-29', '2026-09-30'] };
const old = user({ lastOpen: T('2026-09-27T12:00:00').toISOString() });
assert(/ignored me/.test(check(old, log, T('2026-10-01T18:55:00'))));
assert.equal(check(old, log, T('2026-10-01T21:35:00')), null);
const back = user({ lastOpen: T('2026-10-01T21:36:00').toISOString() }); // opened the app again
assert(check(back, log, T('2026-10-01T21:40:00')));
// The saved progress is never changed by a check (missed marks only live in a copy)
const u = user({ logs: {} });
check(u, {}, T('2026-10-01T23:00:00'));
assert.deepEqual(u.state.logs, {});

console.log('All server checks passed');

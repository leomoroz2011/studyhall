// Checks the rules. Run with: node test.js  (not needed on the website)
process.env.TZ = 'UTC'; // same as the reminder server; the app checks below only use local times, so they don't care
const assert = require('assert');
const { sweep, openSlot, nextSlot, autoMissed, scoreboard } = require('./app.js');

const schedule = [{ day: 1, start: '10:00', end: '10:50' }, { day: 1, start: '22:00', end: '22:50' }]; // Mondays
const t = (d, h, m = 0) => new Date(2026, 8, d, h, m); // Sep 28 2026 is a Monday
const fresh = () => ({ schedule, logs: {}, evening: {}, since: t(27, 12).toISOString() });

// Lock rule: opens when it ends, closes 4h later
let s = fresh();
assert(!openSlot(s, t(28, 10, 49)));
assert.equal(openSlot(s, t(28, 10, 50)).key, '2026-09-28 10:00');
assert(openSlot(s, t(28, 14, 49)));
assert(!openSlot(s, t(28, 14, 50)));
// Late study hall: window stops at midnight (same day only)
assert.equal(openSlot(s, t(28, 23, 59)).key, '2026-09-28 22:00');
assert(!openSlot(s, t(29, 0, 1)));

// Unlogged = missed; logged ones are kept
s.logs['2026-09-28 10:00'] = { r: 'hw', note: 'math' };
sweep(s, t(29, 9));
assert.equal(s.logs['2026-09-28 10:00'].r, 'hw');
assert.equal(s.logs['2026-09-28 22:00'].r, 'missed');

// Nothing before the schedule was saved counts as missed
s = { ...fresh(), logs: {}, since: t(28, 15).toISOString() };
sweep(s, t(29, 9));
assert(!s.logs['2026-09-28 10:00']);
assert.equal(s.logs['2026-09-28 22:00'].r, 'missed');

// Streak rules. Days are Sep 2026: 28 = Monday, so 21 and 14 are Mondays too.
const logs = (...rs) => Object.fromEntries(rs.map(([day, r]) => [`2026-09-${day} 10:00`, { r }]));
const sb = (l, day = 30) => scoreboard(l, t(day, 12));
assert.deepEqual(sb({}), { streak: 0, best: 0, freezes: 1, last: null, frozen: [] }); // everyone starts with 1 freeze
assert.equal(sb(logs([28, 'hw'], [29, 'hw'])).streak, 2);
// A slack uses the freeze and keeps the streak
assert.deepEqual(sb(logs([28, 'hw'], [29, 'slack'], [30, 'hw'])), { streak: 2, best: 2, freezes: 0, last: 'hw', frozen: ['2026-09-29 10:00'] });
assert.equal(sb(logs([28, 'hw'], [29, 'missed'])).last, 'frozen');
// No freeze left: it breaks
assert.deepEqual(sb(logs([28, 'hw'], [29, 'slack'], [30, 'slack'])), { streak: 0, best: 1, freezes: 0, last: 'broke', frozen: ['2026-09-29 10:00'] });
// Comeback: Homework at the very next study hall after a break earns a freeze back
const comeback = { '2026-09-28 10:00': { r: 'hw' }, '2026-09-29 10:00': { r: 'slack' }, '2026-09-29 13:00': { r: 'slack' }, '2026-09-30 10:00': { r: 'hw' } };
assert.deepEqual(sb(comeback), { streak: 1, best: 1, freezes: 1, last: 'comeback', frozen: ['2026-09-29 10:00'] });
// ...but not if you slack at that next study hall too
assert.equal(sb({ ...comeback, '2026-09-30 10:00': { r: 'slack' } }).freezes, 0);
// No freeze wasted when there's no streak to save
assert.equal(sb(logs([28, 'slack'])).freezes, 1);
// +1 freeze each Monday, max 2 (last log Sep 14, now Sep 30 = 2 Mondays later)
assert.equal(sb(logs([14, 'hw'])).freezes, 2);
assert.equal(sb(logs([14, 'hw']), 16).freezes, 1);
// Best-ever survives a break
assert.equal(sb(logs([14, 'hw'], [15, 'hw'], [16, 'hw'], [17, 'slack'], [18, 'slack'], [19, 'slack'])).best, 3);

// Days off. Sep 28 (Mon) is off in these checks; the schedule has two Monday study halls.
const off = (extra = {}) => ({ ...fresh(), daysOff: [{ from: '2026-09-28', to: '2026-09-28' }], ...extra });
// A day off isn't swept as missed (and the next normal Monday still is)
s = off();
sweep(s, t(29, 9));
assert.deepEqual(s.logs, {});
sweep(s, t(30, 9)); // a day later, still nothing
assert.deepEqual(s.logs, {});
// openSlot ignores it
assert(!openSlot(off(), t(28, 10, 55)));
assert(openSlot(fresh(), t(28, 10, 55)));
// nextSlot skips it: on Sun Sep 27 the next study hall is Mon Oct 5, not Mon Sep 28
assert.equal(nextSlot(off(), t(27, 12)).key, '2026-10-05 10:00');
assert.equal(nextSlot(fresh(), t(27, 12)).key, '2026-09-28 10:00');
// ...and a long break: Sep 28 – Oct 11 off, so next is Oct 12
assert.equal(nextSlot(off({ daysOff: [{ from: '2026-09-28', to: '2026-10-11' }] }), t(27, 12)).key, '2026-10-12 10:00');
// Adding a past day off: only the app's own "missed" marks are offered for removal, never your logs
s = fresh();
s.logs = {
  '2026-09-28 10:00': { r: 'missed' },                                  // app-made → removable
  '2026-09-28 22:00': { r: 'slack', at: '2026-09-28T23:00:00Z' },       // yours → kept
  '2026-09-29 10:00': { r: 'missed' },                                  // outside the range → kept
  '2026-09-27 10:00': { r: 'hw', note: 'math', at: 'x' },               // yours → kept
  '2026-09-28 13:00': { r: 'missed', at: 'x' },                         // has "at" → never touched
};
assert.deepEqual(autoMissed(s, '2026-09-28', '2026-09-28'), ['2026-09-28 10:00']);
assert.deepEqual(autoMissed(s, '2026-09-27', '2026-09-30').sort(), ['2026-09-28 10:00', '2026-09-29 10:00']);
// Your own logs on a day off stay exactly as they are, and the scoreboard doesn't change
const mine = { '2026-09-28 10:00': { r: 'hw', note: 'math', at: 'x' }, '2026-09-28 22:00': { r: 'slack', at: 'y' } };
const before = scoreboard(JSON.parse(JSON.stringify(mine)), t(30, 12));
s = off({ logs: JSON.parse(JSON.stringify(mine)) });
sweep(s, t(30, 12));
assert.deepEqual(Object.keys(s.logs).filter(k => k.startsWith('2026-09-28')).map(k => s.logs[k]), Object.values(mine));
assert.deepEqual(scoreboard(Object.fromEntries(Object.entries(s.logs).filter(([k]) => k.startsWith('2026-09-28'))), t(30, 12)), before);

// Share: milestone button
const { isShareMilestone, shareText, oldBest, weekDots } = require('./app.js');
for (const n of [7, 14, 30, 50, 100, 150, 200]) assert(isShareMilestone(n, 99, {}), n);
for (const n of [0, 1, 6, 8, 13, 15, 29, 31, 99]) assert(!isShareMilestone(n, 99, {}), n);
assert(!isShareMilestone(7, 99, { shareShownFor: 7 }));   // already shown for 7
assert(isShareMilestone(9, 8, {}));                        // first day beating a best of 8
assert(!isShareMilestone(5, 4, {}));                       // new best under 7 doesn't count
// Best before the current streak: 3 (Sep 10–12), then a break, then 8 in a row (Sep 20–27)
const run = logs([10, 'hw'], [11, 'hw'], [12, 'hw'], [15, 'slack'], [16, 'slack'], [17, 'slack'],
  ...[20, 21, 22, 23, 24, 25, 26, 27].map(d => [d, 'hw']));
assert.equal(scoreboard(run, t(28, 12)).streak, 8);
assert.equal(oldBest(run, t(28, 12)), 3);
// Shared text: only the number, 🔥 and the link, never notes or activities
const txt = shareText(12);
assert.equal(txt, 'My study hall streak: 12 🔥 Track yours: https://leomoroz2011.github.io/studyhall/');
assert(!/math|Workout|note/.test(txt));
// Week circles match the home screen rules
s = { ...fresh(), logs: { '2026-09-28 10:00': { r: 'hw', note: 'math' } } };
assert.deepEqual(weekDots(s, t(28, 12), []).map(d => d.look + d.letter), ['hwM', 'todayM']);

// Evening answers in History: old true/false unchanged, 'none' gets its own line
const { eveText } = require('./app.js');
assert.equal(eveText(true), 'Old homework that night: yes');
assert.equal(eveText(false), 'Old homework that night: no');
assert.equal(eveText('none'), 'No homework that night');

// Evening check card in the app: only about today, 6:50 PM to midnight, never on a day off
const { eveDue } = require('./app.js');
assert(!eveDue(fresh(), t(28, 18, 49)));
assert(eveDue(fresh(), t(28, 18, 50)));
assert(eveDue(fresh(), t(28, 23, 59)));
assert(!eveDue({ ...fresh(), evening: { '2026-09-28': 'none' } }, t(28, 19)));   // "No homework tonight" counts as answered
assert(!eveDue({ ...fresh(), evening: { '2026-09-28': false } }, t(28, 19)));
// Yesterday's unanswered check is gone after midnight, and nothing gets saved for it
s = fresh();
assert(!eveDue(s, t(29, 0, 1)));
assert(!eveDue(s, t(29, 12)));
assert(eveDue(s, t(29, 18, 50))); // tonight's own check, a new question
assert.deepEqual(s.evening, {});
assert(!eveDue(off(), t(28, 19)));                                                 // day off: no card

// First-open setup: only with no schedule. A phone that has one (with logs) never sees it.
const { needsSetup, withDefaults, readBackup, forServer, badTimes, useSchedule } = require('./app.js');
assert(needsSetup({ schedule: [], logs: {}, evening: {} }));
assert(!needsSetup(fresh()));
// Old saves (before nickname existed) load unchanged, nickname just starts empty
const oldSave = { schedule, logs: { '2026-09-28 10:00': { r: 'hw', note: 'math', at: 'x' } }, evening: { '2026-09-28': true }, since: 'x' };
assert.deepEqual(withDefaults(JSON.parse(JSON.stringify(oldSave))), { activities: {}, myActs: [], daysOff: [], nickname: '', ...oldSave });
// Nickname survives Export backup → Restore, along with everything else
const mineAll = withDefaults({ ...oldSave, nickname: 'Leo', activities: { '2026-09-28': { did: ['Workout'], note: '' } } });
assert.deepEqual(readBackup(JSON.stringify(mineAll, null, 2)), mineAll);
assert.equal(readBackup(JSON.stringify({ hello: 1 })), null);                    // not a Clutch backup
// ...but never goes to the reminder server (neither do notes or activities)
const sent = JSON.stringify(forServer(mineAll));
assert(!/Leo|math|Workout|nickname/.test(sent));
assert.deepEqual(forServer(mineAll).logs, { '2026-09-28 10:00': { r: 'hw' } });
// Setup's schedule check matches Settings: every time filled in, end after start
assert(badTimes({ start: '', end: '10:50' }) && badTimes({ start: '10:50', end: '10:00' }) && !badTimes({ start: '10:00', end: '10:50' }));
// Saving the schedule counts from now on, so nothing before it turns into "missed"
s = { schedule: [], logs: {}, evening: {}, since: null };
useSchedule(s, schedule, t(28, 15));
sweep(s, t(28, 23, 0));
assert.equal(s.since, t(28, 15).toISOString());
assert.deepEqual(Object.keys(s.logs), []); // the 10:00 hall's window closed before setup; the 22:00 one is still open

// Reminder server rules (worker/check.js). Pacific time; Oct 1 2026 is a Thursday, study hall 8:30–9:30 PM.
import('./worker/check.js').then(({ check }) => {
  const P = hm => new Date(`2026-10-01T${hm}:00-07:00`); // Pacific daylight time
  const user = (extra = {}) => ({ tz: 'America/Los_Angeles', state: {
    schedule: [{ day: 4, start: '20:30', end: '21:30' }], logs: { '2026-09-24 20:30': { r: 'hw' } }, evening: {},
    since: '2026-09-01T00:00:00Z', lastOpen: P('12:00').toISOString(), ...extra } });
  const send = (u, hm, log = {}) => check(u, log, P(hm)).text;
  assert(send(user(), '18:55'));                                              // evening reminder at 6:55
  assert(!send(user({ evening: { '2026-10-01': 'none' } }), '18:55'));       // "No homework tonight" = answered
  assert(!send(user({ evening: { '2026-09-30': true } }), '13:00'));         // yesterday's check never nags today...
  assert(!send(user({ evening: {} }), '12:00'));                              // ...even if it was never answered
  assert(!send(user(), '19:05'));                                             // late 6:50 run lands at 7:05: quiet
  assert(!send(user(), '21:29'));
  assert(send(user(), '21:35', { day: '2026-10-01', sent: ['eve'] }));        // study hall reminder at 9:35
  assert(!send(user(), '22:05'));                                             // overnight quiet hours
  assert(!send(user(), '06:55'));
  const dayOff = user({ daysOff: [{ from: '2026-09-30', to: '2026-10-03' }] }); // a 4-day weekend
  assert(!send(dayOff, '18:55'));                                             // no evening reminder
  assert(!send(dayOff, '21:35'));                                             // no study hall reminder
  assert.equal(check(dayOff, {}, P('18:55')).why, 'day off');
  assert.equal(check(user(), { day: '2026-10-01', sent: ['eve', '2026-10-01 20:30'] }, P('21:40')).why, 'already sent 2 today');
  console.log('All checks passed');
});

// Run by GitHub every 10 minutes from ~6 AM to 10 PM (see workflows/reminder.yml).
// Decides whether a reminder is due, writes it with your real streak, and sends it to your devices.
const webpush = require('web-push');
const { ymd, at, sweep, slotsOn, scoreboard, putVar } = require('../app.js');
const msgs = require('./messages.js');

const now = new Date(); // the workflow sets TZ=America/Denver, so this is your local time
const test = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch'; // "Run workflow" button = send one right now
const state = process.env.STATE ? JSON.parse(process.env.STATE) : null; // synced from your phone (null = not connected yet)
const log = process.env.NOTIFY ? JSON.parse(process.env.NOTIFY) : {}; // what this script sent before
const today = ymd(now);
if (log.day !== today) Object.assign(log, { day: today, sent: [] });
log.days ||= []; // days a reminder was sent
log.last ||= {}; // last message used per type, so it never repeats back-to-back

// What's due right now? At most one study-hall reminder + one evening reminder a day, none from 10 PM to 7 AM.
let due = null;
if (state) sweep(state, now);
const quiet = now < at(now, '07:00') || now >= at(now, '22:00');
if (test) due = 'eve';
else if (!quiet) {
  const sh = state && !log.sent.some(k => k !== 'eve') &&
    slotsOn(now, state.schedule).find(s => s.end <= now && now < s.close && !state.logs[s.key]); // ended, not logged yet
  if (now >= at(now, '18:50') && now < at(now, '19:50') && !log.sent.includes('eve') && !(state && today in state.evening))
    due = 'eve';
  else if (sh) due = sh.key;
}
if (!due) process.exit(0);

// Ignored 3 days in a row (reminders sent, app not opened) → one last message, then pause until you open the app.
const opened = state ? new Date(state.lastOpen) : now;
if (log.paused && opened > new Date(log.paused)) { delete log.paused; log.days = []; } // you're back
if (log.paused && !test) process.exit(0);
log.days = log.days.filter(d => d > ymd(opened));
const chill = !test && log.days.length >= 3 && !log.days.includes(today);

let text;
if (chill) { text = msgs.chill; log.paused = now.toISOString(); }
else if (!state) text = 'Evening check time! 🌙 (Connect smart reminders in the app to see your streak here.)';
else {
  const sb = scoreboard(state.logs, now), type = due === 'eve' ? 'eve' : 'sh';
  const pool = sb.streak ? type : type === 'sh' && sb.last === 'broke' ? 'shBack' : `${type}0`;
  let i;
  do i = Math.floor(Math.random() * msgs[pool].length); while (msgs[pool].length > 1 && i === log.last[pool]);
  log.last[pool] = i;
  text = msgs[pool][i](sb.streak, sb.freezes);
}
console.log(test ? 'TEST:' : `Due: ${due}.`, text);

webpush.setVapidDetails(
  'https://leomoroz2011.github.io/studyhall/',
  'BKnyV02fu2IcOi6q4_Oe1Q9XYG0P4gjLHRZCzh0xnfJbIfmSZOH8tVELvLWGK6Bb97q-LCqvUc6I6aDcjsQu6lQ',
  process.env.VAPID_PRIVATE_KEY,
);
// One secret per device (phone, computer). A device with no secret saved is skipped.
const devices = { phone: process.env.PUSH_SUBSCRIPTION, computer: process.env.PUSH_SUBSCRIPTION_COMPUTER };
(async () => {
  for (const [name, code] of Object.entries(devices)) {
    if (!code) continue;
    // A badly pasted secret only fails that device, it doesn't stop the others.
    await new Promise(ok => ok(webpush.sendNotification(JSON.parse(code), text)))
      .then(() => console.log(`Sent to ${name}`))
      .catch(err => { console.error(name, err.body || err); process.exitCode = 1; }); // fails loudly → GitHub emails you
  }
  if (test || !process.env.SYNC_TOKEN) return;
  log.sent.push(due);
  if (!chill && !log.days.includes(today)) log.days.push(today);
  await putVar(process.env.SYNC_TOKEN, 'NOTIFY', JSON.stringify(log));
})();

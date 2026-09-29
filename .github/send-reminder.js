// Run by GitHub every evening (see workflows/reminder.yml). Sends the push notification to your phone.
const webpush = require('web-push');

// Only one of the two daily runs is 6:50 PM in Denver; skip the other. (Manual test runs have no SCHEDULE.)
const summer = new Date().toLocaleString('en-US', { timeZone: 'America/Denver', timeZoneName: 'short' }).endsWith('MDT');
if (process.env.SCHEDULE && process.env.SCHEDULE !== (summer ? '50 0 * * *' : '50 1 * * *')) process.exit(0);

webpush.setVapidDetails(
  'https://leomoroz2011.github.io/studyhall/',
  'BKnyV02fu2IcOi6q4_Oe1Q9XYG0P4gjLHRZCzh0xnfJbIfmSZOH8tVELvLWGK6Bb97q-LCqvUc6I6aDcjsQu6lQ',
  process.env.VAPID_PRIVATE_KEY,
);
// One secret per device (phone, computer). A device with no secret saved is skipped.
const devices = { phone: process.env.PUSH_SUBSCRIPTION, computer: process.env.PUSH_SUBSCRIPTION_COMPUTER };
for (const [name, code] of Object.entries(devices)) {
  if (!code) continue;
  // new Promise(...) turns a badly pasted secret into a failure for this device only, not a crash for all of them.
  new Promise(ok => ok(webpush.sendNotification(JSON.parse(code),
    'Evening check: are you doing homework tonight that was assigned before today?')))
    .then(() => console.log(`Sent to ${name}`))
    .catch(err => { console.error(name, err.body || err); process.exitCode = 1; }); // fails loudly → GitHub emails you
}
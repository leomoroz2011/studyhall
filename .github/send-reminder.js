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
webpush.sendNotification(JSON.parse(process.env.PUSH_SUBSCRIPTION),
  'Evening check: are you doing homework tonight that was assigned before today?')
  .then(() => console.log('Sent'))
  .catch(err => { console.error(err.body || err); process.exit(1); }); // fails loudly → GitHub emails you

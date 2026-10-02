// Clutch reminder server (a Cloudflare Worker). Each phone signs itself up with one tap in the app.
// Every 5 minutes it checks everyone and sends a reminder if one is due (study hall just ended, or the 6:50 PM check).
// Saved per person: u:<id> = { tz, sub, state } (written by the phone), log:<id> = what was sent (written here).
import { buildPushPayload } from '@block65/webcrypto-web-push';
import app from '../app.js';
import msgs from './messages.cjs';

const { ymd, at, sweep, openSlot, scoreboard } = app;
const APP = 'https://leomoroz2011.github.io';
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

// The person's own clock time. Workers run in UTC, so this Date's "local" fields are their local time.
export function wall(tz, d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric',
    day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d).map(x => [x.type, +x.value]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
}

// Is a reminder due for this person right now? Same rules as before: at most one study-hall reminder and one
// evening reminder a day, none from 10 PM to 7 AM, and a pause after 3 ignored days. Returns the text, or null.
export function check(user, log, realNow) {
  const now = wall(user.tz, realNow), today = ymd(now);
  // a copy: sweep() adds "missed" marks, which only matter for the streak in the message (never saved)
  const st = { ...user.state, logs: { ...user.state.logs }, since: wall(user.tz, new Date(user.state.since || 0)).toISOString() };
  if (log.day !== today) Object.assign(log, { day: today, sent: [] });
  log.days ||= []; // days a reminder was sent
  log.last ||= {}; // last message used per type, so it never repeats back-to-back

  if (st.schedule.length && user.state.since) sweep(st, now);
  if (now < at(now, '07:00') || now >= at(now, '22:00')) return null;
  const sh = !log.sent.some(k => k !== 'eve') && openSlot(st, now);
  let due = null;
  if (now >= at(now, '18:50') && now < at(now, '19:50') && !log.sent.includes('eve') && !(today in (st.evening || {}))) due = 'eve';
  else if (sh) due = sh.key;
  if (!due) return null;

  // Ignored 3 days in a row (reminders sent, app not opened) → one last message, then pause until they open the app.
  const opened = new Date(st.lastOpen || 0);
  if (log.paused && opened > new Date(log.paused)) { delete log.paused; log.days = []; }
  if (log.paused) return null;
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
  return text;
}

async function push(env, sub, text) {
  const vapid = { subject: `${APP}/studyhall/`, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
  return fetch(sub.endpoint, await buildPushPayload({ data: text, options: { ttl: 3600 } }, sub, vapid));
}
const gone = res => res.status === 404 || res.status === 410; // the phone dropped this subscription

const reply = (body, status = 200) => new Response(body, { status, headers: { 'Access-Control-Allow-Origin': APP } });

export default {
  // The app talks to this. Body is plain text JSON (no preflight needed).
  async fetch(req, env) {
    if (req.method !== 'POST') return reply('Clutch reminders');
    const body = await req.text();
    if (body.length > 60000) return reply('too big', 413);
    let d;
    try { d = JSON.parse(body); } catch { return reply('bad json', 400); }
    if (!/^[A-Za-z0-9-]{20,64}$/.test(d.id || '')) return reply('bad id', 400);
    const path = new URL(req.url).pathname;

    if (path === '/sync') { // save this phone's subscription + progress
      try { wall(d.tz, new Date()); } catch { return reply('bad tz', 400); }
      if (!PUSH_HOSTS.test(d.sub?.endpoint || '') || !d.sub.keys?.p256dh || !d.sub.keys?.auth) return reply('bad sub', 400);
      if (!Array.isArray(d.state?.schedule) || typeof d.state.logs !== 'object') return reply('bad state', 400);
      await env.USERS.put(`u:${d.id}`, JSON.stringify({ tz: d.tz, sub: d.sub, state: d.state }));
      return reply('ok');
    }
    if (path === '/test') { // "Send a test reminder" button
      const user = await env.USERS.get(`u:${d.id}`, 'json');
      if (!user) return reply('not signed up', 404);
      const res = await push(env, user.sub, 'Test from Clutch. Reminders work.');
      return reply(res.ok ? 'ok' : `push service said ${res.status}`, res.ok ? 200 : 502);
    }
    return reply('not found', 404);
  },

  // Every 5 minutes (see wrangler.toml).
  // ponytail: reads every user each run; fine for a few dozen people on the free plan, batch or use D1 past that
  async scheduled(_, env) {
    const now = new Date();
    let cursor;
    do {
      const page = await env.USERS.list({ prefix: 'u:', cursor });
      for (const { name } of page.keys) {
        const id = name.slice(2), user = await env.USERS.get(name, 'json');
        const log = (await env.USERS.get(`log:${id}`, 'json')) || {};
        const text = user && check(user, log, now);
        if (!text) continue;
        const res = await push(env, user.sub, text).catch(err => ({ ok: false, status: String(err) }));
        if (gone(res)) { await env.USERS.delete(name); await env.USERS.delete(`log:${id}`); continue; }
        console.log(id.slice(0, 6), res.status, text);
        if (res.ok) await env.USERS.put(`log:${id}`, JSON.stringify(log));
      }
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
  },
};

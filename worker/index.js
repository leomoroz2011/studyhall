// Clutch reminder server (a Cloudflare Worker). Each phone signs itself up with one tap in the app.
// Every 5 minutes it checks everyone and sends a reminder if one is due (study hall just ended, or the 6:50 PM check).
// Saved per person: u:<id> = { tz, sub, state } (written by the phone), log:<id> = what was sent (written here).
import { buildPushPayload } from '@block65/webcrypto-web-push';
import { wall, check } from './check.js'; // the reminder rules

const APP = 'https://leomoroz2011.github.io';
const PUSH_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(push\.apple\.com|fcm\.googleapis\.com|push\.services\.mozilla\.com|notify\.windows\.com)\//;

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
    let cursor;
    do {
      const page = await env.USERS.list({ prefix: 'u:', cursor });
      for (const { name } of page.keys) {
        const id = name.slice(2), user = await env.USERS.get(name, 'json');
        const log = (await env.USERS.get(`log:${id}`, 'json')) || {};
        const text = user && check(user, log, new Date()).text; // the real time right now, checked per person
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

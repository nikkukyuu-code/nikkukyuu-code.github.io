// transfer: short 引き継ぎID (XXXX-XXXX) + 6-digit PIN for the shared portal transfer page.
// The client encrypts the whole transfer payload with a key derived from ID+PIN (PBKDF2) and sends
// only the ciphertext plus an auth token derived separately from ID+PIN, so the server cannot read the data.
// D1 binding DB. Production rows are protected by triggers (see transfer-schema.sql); rows can only be
// removed after they have been expired for 30+ days (expiry policy, 90 days after the last upload).
const ORIGINS = ['https://nikkukyuu-code.github.io'];
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0 O 1 I L
const DAY = 86400e3, KEEP = 90 * DAY, MAX_BLOB = 1500000;
const cors = (q) => { const o = q.headers.get('Origin') || ''; return { 'Access-Control-Allow-Origin': ORIGINS.includes(o) || LOCAL.test(o) ? o : ORIGINS[0], 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400', Vary: 'Origin' }; };
const J = (q, o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...cors(q) } });
const E = (q, e, m, s = 400) => J(q, { ok: false, error: e, message: m }, s);
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const normId = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const validId = (id) => id.length === 8 && [...id].every((c) => ALPHA.includes(c));
function newId() { const r = crypto.getRandomValues(new Uint8Array(8)); let s = ''; for (const b of r) s += ALPHA[b % ALPHA.length]; return s; }
const body = async (q) => { try { return await q.json(); } catch (_) { return {}; } };
async function hits(env, key, now, win) { const r = await env.DB.prepare('SELECT COUNT(*) c FROM attempts WHERE k = ? AND at > ?').bind(key, now - win).first(); return r.c; }
const note = (env, key, now) => env.DB.prepare('INSERT INTO attempts (k, at) VALUES (?, ?)').bind(key, now).run();
export default {
  async fetch(q, env, ctx) {
    if (q.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(q) });
    const u = new URL(q.url), p = u.pathname.replace(/\/+$/, '') || '/', ip = q.headers.get('CF-Connecting-IP') || '0', now = Date.now();
    try {
      if (p === '/' || p === '/health') return J(q, { ok: true, service: 'transfer' });
      // Reserve a new unique ID (no data yet). Client then derives keys from ID+PIN and calls /save.
      if (p === '/issue' && q.method === 'POST') {
        if (await hits(env, 'issue:' + ip, now, 3600e3) >= 20) return E(q, 'rate', '発行が多すぎます。しばらくしてからもう一度お試しください', 429);
        await note(env, 'issue:' + ip, now);
        for (let i = 0; i < 8; i++) {
          const id = newId();
          try { await env.DB.prepare('INSERT INTO codes (id, auth_hash, blob, size, created_at, updated_at, expires_at) VALUES (?, NULL, NULL, 0, ?, ?, ?)').bind(id, now, now, now + DAY).run(); return J(q, { ok: true, id }); }
          catch (e) { if (!/UNIQUE|PRIMARY/i.test(String(e && e.message))) throw e; }
        }
        return E(q, 'busy', 'もう一度お試しください', 503);
      }
      // Save / refresh data under an ID. First save sets the auth; later saves must present the same auth.
      if (p === '/save' && q.method === 'POST') {
        const b = await body(q), id = normId(b.id);
        if (!validId(id) || typeof b.auth !== 'string' || b.auth.length !== 64 || typeof b.blob !== 'string' || !b.blob || b.blob.length > MAX_BLOB) return E(q, 'bad', 'データが不正です');
        if (await hits(env, 'save:' + ip, now, 3600e3) >= 60) return E(q, 'rate', '保存が多すぎます。しばらくしてからお試しください', 429);
        await note(env, 'save:' + ip, now);
        const row = await env.DB.prepare('SELECT auth_hash, expires_at FROM codes WHERE id = ?').bind(id).first();
        if (!row) return E(q, 'notfound', 'このIDは使えません。新しく発行してください', 404);
        const ah = await sha('auth|' + b.auth);
        if (row.auth_hash && row.auth_hash !== ah) return E(q, 'auth', 'このIDは別のPINで使われています', 403);
        if (!row.auth_hash && row.expires_at < now) return E(q, 'notfound', 'このIDの期限が切れました。新しく発行してください', 404);
        const exp = now + KEEP;
        await env.DB.prepare('UPDATE codes SET auth_hash = ?, blob = ?, size = ?, updated_at = ?, expires_at = ? WHERE id = ?').bind(ah, b.blob, b.blob.length, now, exp, id).run();
        return J(q, { ok: true, id, updated_at: now, expires_at: exp });
      }
      // Restore. Wrong ID or PIN look the same. Lockout: 5 failures per ID / 15 min, 30 failures per IP / hour.
      if (p === '/load' && q.method === 'POST') {
        const b = await body(q), id = normId(b.id);
        if (!validId(id) || typeof b.auth !== 'string' || b.auth.length !== 64) return E(q, 'bad', 'IDは8文字（例：AB2C-D3EF）、PINは6けたの数字です');
        if (await hits(env, 'fail:id:' + id, now, 900e3) >= 5) return E(q, 'locked', '間違いが続いたので15分ほどお待ちください', 429);
        if (await hits(env, 'fail:ip:' + ip, now, 3600e3) >= 30) return E(q, 'locked', '間違いが続いたので1時間ほどお待ちください', 429);
        const row = await env.DB.prepare('SELECT auth_hash, blob, updated_at, expires_at FROM codes WHERE id = ?').bind(id).first();
        const ok = row && row.auth_hash && row.blob && row.expires_at > now && row.auth_hash === await sha('auth|' + b.auth);
        if (!ok) {
          await env.DB.batch([env.DB.prepare('INSERT INTO attempts (k, at) VALUES (?, ?)').bind('fail:id:' + id, now), env.DB.prepare('INSERT INTO attempts (k, at) VALUES (?, ?)').bind('fail:ip:' + ip, now)]);
          return E(q, 'auth', 'IDかPINが違います（または期限切れです）', 403);
        }
        return J(q, { ok: true, id, blob: row.blob, updated_at: row.updated_at, expires_at: row.expires_at });
      }
      return E(q, 'notfound', 'not found', 404);
    } catch (e) {
      return E(q, 'server', 'サーバーエラー: ' + String((e && e.message) || e).slice(0, 120), 500);
    }
  },
  // Daily housekeeping: only throwaway rate-limit rows and codes expired for 30+ days (policy) are removed.
  async scheduled(ev, env, ctx) {
    const now = Date.now();
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare('DELETE FROM attempts WHERE at < ?').bind(now - 2 * DAY),
      env.DB.prepare('DELETE FROM codes WHERE expires_at < ?').bind(now - 30 * DAY),
    ]));
  },
};

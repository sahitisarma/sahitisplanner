// Sahiti's Planner: always-connected Google helper (Cloudflare Worker, free plan).
//
// Why this exists: browsers only get Google access for about an hour at a time.
// This tiny server keeps a long-lived Google "refresh token" safely on the server
// and hands the planner a fresh access token whenever it asks. Result: Google
// Calendar and Tasks stay connected, no reconnecting.
//
// Needs (set in the Cloudflare dashboard):
//   KV namespace binding:  SP_KV
//   Variables / secrets:   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
//                          APP_ORIGIN (e.g. https://sahitisarma.github.io)

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/drive.appdata',
  'openid', 'email',
].join(' ');

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = (env.APP_ORIGIN || '').replace(/\/$/, '');
    const cors = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...cors } });

    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

    // 1) Start sign-in: send the browser to Google, asking for offline access.
    if (url.pathname === '/auth/start') {
      const ret = url.searchParams.get('return') || '';
      if (!origin || !ret.startsWith(`${origin}/`)) return new Response('This server only works with the planner it was set up for.', { status: 400 });
      const state = randomHex(16);
      await env.SP_KV.put(`state:${state}`, ret, { expirationTtl: 600 });
      const p = new URLSearchParams({
        client_id: env.GOOGLE_CLIENT_ID,
        redirect_uri: `${url.origin}/auth/callback`,
        response_type: 'code',
        scope: SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: 'true',
        state,
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${p}`, 302);
    }

    // 2) Google sends the browser back here with a one-time code.
    if (url.pathname === '/auth/callback') {
      const state = url.searchParams.get('state') || '';
      const ret = await env.SP_KV.get(`state:${state}`);
      if (!ret) return new Response('Sign-in expired. Go back to the planner and try again.', { status: 400 });
      await env.SP_KV.delete(`state:${state}`);
      const back = (hash) => Response.redirect(`${ret}#${hash}`, 302);
      if (url.searchParams.get('error')) return back(`sp_error=${encodeURIComponent(url.searchParams.get('error'))}`);
      const tok = await googleToken(env, {
        code: url.searchParams.get('code'),
        redirect_uri: `${url.origin}/auth/callback`,
        grant_type: 'authorization_code',
      });
      if (!tok.refresh_token) return back('sp_error=no_refresh_token');
      const session = randomHex(32);
      await env.SP_KV.put(`s:${await sha256(session)}`, JSON.stringify({ rt: tok.refresh_token, at: Date.now() }));
      return back(`sp_session=${session}&access_token=${encodeURIComponent(tok.access_token)}&expires_in=${tok.expires_in || 3600}`);
    }

    // Everything below is called by the planner page only.
    if (req.method !== 'POST') return new Response('Not found', { status: 404 });
    if (req.headers.get('Origin') !== origin) return json({ error: 'origin' }, 403);
    let body = {};
    try { body = await req.json(); } catch {}
    const key = body.session ? `s:${await sha256(String(body.session))}` : null;
    const rec = key ? JSON.parse((await env.SP_KV.get(key)) || 'null') : null;
    if (!rec) return json({ error: 'signed_out' }, 401);

    // Voice note transcripts (needs the Workers AI binding named AI).
    if (url.pathname === '/transcribe') {
      if (!env.AI) return json({ error: 'no_ai' }, 501);
      if (!body.audio || body.audio.length > 25_000_000) return json({ error: 'bad_audio' }, 400);
      try {
        const out = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: body.audio });
        return json({ text: (out.text || '').trim() });
      } catch (e) { return json({ error: 'ai_error' }, 502); }
    }

    // Read handwriting from a picture of your list (needs the Workers AI binding named AI).
    if (url.pathname === '/read') {
      if (!env.AI) return json({ error: 'no_ai' }, 501);
      const n = Math.max(1, Math.min(60, Number(body.lines) || 1));
      if (!body.image || body.image.length > 8_000_000) return json({ error: 'bad_image' }, 400);
      const prompt = `This image shows ${n} handwritten line${n > 1 ? 's' : ''} from a to-do or shopping list, one per white strip, top to bottom. ` +
        `Transcribe exactly what is written on each line. Fix nothing, add nothing, keep the person's words. ` +
        `Reply with only a JSON array of ${n} strings, one per line in order, like ["milk","call mom"].`;
      const messages = [{ role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${body.image}` } },
      ] }];
      try {
        const out = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', { messages, max_tokens: 800, temperature: 0 });
        const text = String(out.response ?? out.result?.response ?? '');
        const m = text.match(/\[[\s\S]*\]/);
        const lines = m ? JSON.parse(m[0]).map((x) => String(x).trim()) : [];
        return json({ lines });
      } catch (e) { return json({ error: 'ai_error', detail: String(e).slice(0, 200) }, 502); }
    }

    // 3) Fresh access token, any time.
    if (url.pathname === '/token') {
      const tok = await googleToken(env, { refresh_token: rec.rt, grant_type: 'refresh_token' });
      if (tok.error === 'invalid_grant') { await env.SP_KV.delete(key); return json({ error: 'signed_out' }, 401); }
      if (!tok.access_token) return json({ error: tok.error || 'google_error' }, 502);
      return json({ access_token: tok.access_token, expires_in: tok.expires_in || 3600 });
    }

    // 4) Disconnect.
    if (url.pathname === '/revoke') {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rec.rt)}`, { method: 'POST' }).catch(() => {});
      await env.SP_KV.delete(key);
      return json({ ok: true });
    }
    return json({ error: 'not_found' }, 404);
  },
};

async function googleToken(env, params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return res.json();
}
function randomHex(bytes) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

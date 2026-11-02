'use strict';
// <dev.commit> server: serves dist/, the /admin panel and its API, and stores contact inquiries.
// No dependencies. See README.md ("Security") for what is and is not covered.
process.env.SERVER_MODE = '1';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), net = require('net');
const { build } = require('./build.js');
const SEC = require('./lib/security.js');
const I = require('./lib/i18n.js');

const R = __dirname, DATA = path.join(R, 'data'), DIST = path.join(R, 'dist'), ADMIN = path.join(R, 'admin');
const IMG = path.join(R, 'assets/img/projects');
const PROD = process.env.NODE_ENV === 'production';
const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || (PROD ? '0.0.0.0' : '127.0.0.1');
const TRUST = process.env.TRUST_PROXY === '1';
const HOPS = Math.max(1, Math.min(5, +process.env.PROXY_HOPS || 1)); // trusted proxies in front of this server
const ADMIN_IPS = (process.env.ADMIN_ALLOWED_IPS || '').split(',').map(s => s.trim()).filter(Boolean);
const SITE_HOST = (() => { try { return new URL(process.env.SITE_URL || '').host.toLowerCase(); } catch { return ''; } })();
const IDLE_MS = 2 * 36e5, ABS_MS = 12 * 36e5; // admin session: 2 h idle, 12 h absolute

const HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Permitted-Cross-Domain-Policies': 'none', 'Origin-Agent-Cluster': '?1'
};
if (PROD) HEADERS['Strict-Transport-Security'] = 'max-age=63072000; includeSubDomains';

const J = f => path.join(DATA, f);
const rj = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const wj = (f, o, mode = 0o600) => { fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 }); const t = f + '.' + process.pid + '.tmp'; fs.writeFileSync(t, JSON.stringify(o, null, 2), { mode }); fs.renameSync(t, f); };
const err = (m, s = 400) => Object.assign(new Error(m), { status: s, pub: true });
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}\.[^\s@<>"]{2,}$/;
const clean1 = s => String(s ?? '').replace(/[\r\n\t]+/g, ' ').trim();

// Content-Security-Policy (the form endpoint may be an external https service)
let CSP = '';
function refreshCsp() {
  let origin = ''; const ep = process.env.FORM_ENDPOINT || rj(path.join(R, 'content/site.json'), {}).formEndpoint || '';
  try { if (/^https:\/\//.test(ep)) origin = new URL(ep).origin; } catch { /* ignore */ }
  CSP = SEC.csp({ formOrigin: origin, production: PROD });
}

// ---------- request helpers ----------
const body = (req, max) => new Promise((ok, no) => {
  if (+req.headers['content-length'] > max) return no(err('Request too large', 413));
  const c = []; let n = 0, done = false;
  req.on('data', d => { if (done) return; n += d.length; if (n > max) { done = true; no(err('Request too large', 413)); } else c.push(d); });
  req.on('end', () => { if (!done) ok(Buffer.concat(c)); });
  req.on('error', no);
});
const jbody = async (req, max = 1e6) => {
  const hasBody = +req.headers['content-length'] > 0 || !!req.headers['transfer-encoding'];
  if (hasBody && !/^application\/json\b/i.test(req.headers['content-type'] || '')) throw err('Unsupported content type', 415);
  try { const o = JSON.parse((await body(req, max)).toString() || '{}'); if (!o || typeof o !== 'object') throw 0; return o; }
  catch (e) { throw e.pub ? e : err('Invalid JSON'); }
};
const send = (res, s, o, h = {}) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...HEADERS, ...h }); res.end(JSON.stringify(o)); };
const cookieOf = req => { const m = {}; for (const x of String(req.headers.cookie || '').split(/;\s*/)) { const i = x.indexOf('='); if (i > 0) m[x.slice(0, i)] = x.slice(i + 1); } return m['__Host-sid'] || m.sid || ''; };
const secure = req => !!req.socket.encrypted || (TRUST && req.headers['x-forwarded-proto'] === 'https');
const cookieStr = (req, val, maxAge) => `${secure(req) ? '__Host-sid' : 'sid'}=${val}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure(req) ? '; Secure' : ''}`;
const ipOf = req => {
  const sock = req.socket.remoteAddress || '?';
  if (!TRUST) return sock;
  // Take the entry added by our own trusted proxy (counting from the right), never the client-supplied first one.
  const xs = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  const v = xs.length ? xs[Math.max(0, xs.length - HOPS)] : sock;
  return net.isIP(v) ? v : sock;
};
// Browsers always attach Origin / Sec-Fetch-Site to cross-site requests; refuse anything that is not same-site.
function sameSite(req) {
  const sf = req.headers['sec-fetch-site'];
  if (sf && sf !== 'same-origin' && sf !== 'none') return false;
  const o = req.headers.origin; if (!o) return true; if (o === 'null') return false;
  let h; try { h = new URL(o).host.toLowerCase(); } catch { return false; }
  const ok = new Set([String(req.headers.host || '').toLowerCase()]);
  if (TRUST && req.headers['x-forwarded-host']) ok.add(String(req.headers['x-forwarded-host']).split(',')[0].trim().toLowerCase());
  if (SITE_HOST) ok.add(SITE_HOST);
  return ok.has(h);
}

// ---------- limits, sessions, audit ----------
const L = {
  req: new SEC.Limiter(300, 6e4), api: new SEC.Limiter(150, 6e4),
  loginFail: new SEC.Limiter(5, 9e5), loginAcct: new SEC.Limiter(30, 9e5), loginAll: new SEC.Limiter(60, 3e5),
  contact: new SEC.Limiter(5, 36e5), contactAll: new SEC.Limiter(80, 36e5), ackTo: new SEC.Limiter(1, 864e5), ackAll: new SEC.Limiter(100, 864e5)
};
const sess = new Map();
let audit = rj(J('audit.json'), []);
const auditEvent = (event, detail = {}) => { audit.unshift({ id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), event, ...detail }); if (audit.length > 500) audit.length = 500; wj(J('audit.json'), audit); };
setInterval(() => { const n = Date.now(); for (const [k, v] of sess) if (v.exp < n || v.abs < n) sess.delete(k); for (const l of Object.values(L)) l.sweep(); }, 6e5).unref();
const session = req => {
  const k = cookieOf(req), s = k && sess.get(k), n = Date.now();
  if (!s || s.exp <= n || s.abs <= n) { if (s) sess.delete(k); return null; }
  s.exp = Math.min(n + IDLE_MS, s.abs); return s;
};
const getAdmin = () => rj(J('admin.json'), null);
const DUMMY = { salt: '00'.repeat(16), hash: '00'.repeat(64), kdf: SEC.KDF_NEW };

async function ensureAdmin() {
  if (fs.existsSync(J('admin.json'))) return;
  const pw = process.env.ADMIN_PASSWORD;
  if (pw && !SEC.passwordProblem(pw)) {
    wj(J('admin.json'), { email: (process.env.ADMIN_EMAIL || 'devcommitt@gmail.com').toLowerCase(), ...(await SEC.makePasswordRecord(pw)) });
    console.log('Admin account created from ADMIN_PASSWORD.');
  } else console.log(pw ? 'ADMIN_PASSWORD rejected: ' + SEC.passwordProblem(pw) : 'No admin account yet. Run: npm run create-admin');
}

// Second factor: a 6-digit authenticator code, or a one-time recovery code.
function secondFactor(a, code) {
  code = String(code || '').trim();
  if (/^\d{3}\s?\d{3}$/.test(code)) {
    const step = SEC.totpCheck(a.totp.secret, code, a.totp.lastStep || 0);
    if (step < 0) return false;
    a.totp.lastStep = step; wj(J('admin.json'), a); return true;
  }
  const h = SEC.sha(SEC.normRecovery(code)), i = (a.totp.recovery || []).indexOf(h);
  if (i < 0) return false;
  a.totp.recovery.splice(i, 1); wj(J('admin.json'), a); auditEvent('admin.recovery_code_used', { left: a.totp.recovery.length });
  return true;
}

async function login(req, res, ip) {
  if (!L.loginAll.hit('*')) throw err('Too many sign-in attempts. Please wait a few minutes.', 429);
  if (L.loginFail.blocked(ip)) throw err('Too many attempts. Try again in 15 minutes.', 429);
  const b = await jbody(req, 4096), email = clean1(b.email).toLowerCase().slice(0, 200);
  if (L.loginAcct.blocked(email || '?')) throw err('Too many attempts. Try again in 15 minutes.', 429);
  const a = getAdmin(), pw = String(b.password || '');
  // Identical work whether or not the account exists, so response time reveals nothing.
  let ok = await SEC.checkPassword(pw, a && a.salt ? a : DUMMY) && !!a && email === a.email;
  if (ok && a.totp) ok = secondFactor(a, b.code);
  if (!ok) { L.loginFail.hit(ip); L.loginAcct.hit(email || '?'); auditEvent('admin.login_failed', { ip }); throw err('Incorrect email, password or code.', 401); }
  L.loginFail.clear(ip);
  if (SEC.needsRehash(a)) { Object.assign(a, await SEC.makePasswordRecord(pw)); wj(J('admin.json'), a); }
  auditEvent('admin.login', { email: a.email, ip });
  const sid = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(24).toString('hex'), n = Date.now();
  sess.set(sid, { csrf, exp: n + IDLE_MS, abs: n + ABS_MS, email: a.email });
  send(res, 200, { csrf, email: a.email, totp: !!a.totp }, { 'Set-Cookie': cookieStr(req, sid, ABS_MS / 1000) });
}

// ---------- content validation ----------
const SLUG = /^[a-z0-9-]{1,80}$/, UPLOADED = /^\/assets\/img\/projects\/[a-z0-9][a-z0-9_-]*\.(jpg|png|webp)$/;
function cleanProjects(a) {
  if (!Array.isArray(a) || a.length > 200) throw err('Invalid projects list');
  const seen = new Set();
  return a.map(p => {
    if (!p || typeof p !== 'object') throw err('Invalid project');
    const s = (k, max = 2000) => { const v = p[k]; if (v == null || v === '') return ''; if (typeof v !== 'string' || v.length > max) throw err(`Field "${k}" is invalid or too long`); return v.trim(); };
    const arr = k => { const v = p[k] || []; if (!Array.isArray(v) || v.length > 30 || v.some(x => typeof x !== 'string' || x.length > 500)) throw err(`Field "${k}" is invalid`); return v.map(x => x.trim()).filter(Boolean); };
    const o = { slug: s('slug', 80), demo: !!p.demo, featured: !!p.featured, title: s('title', 200), client: s('client', 200), category: s('category', 100), summary: s('summary', 600), services: arr('services'), url: s('url', 500), image: s('image', 300), mobileImage: s('mobileImage', 300), overview: s('overview', 4000), goals: arr('goals'), challenges: arr('challenges'), approach: s('approach', 4000), tech: arr('tech'), outcomes: arr('outcomes') };
    if (!SLUG.test(o.slug)) throw err('Slug must use lowercase letters, numbers and hyphens only');
    if (seen.has(o.slug)) throw err('Duplicate slug: ' + o.slug);
    seen.add(o.slug);
    if (!o.title || !o.category || !o.summary) throw err(`"${o.slug}" needs a title, category and summary`);
    if (o.url && !/^https?:\/\//.test(o.url)) throw err('Live site URL must start with https://');
    for (const k of ['image', 'mobileImage']) if (o[k] && !UPLOADED.test(o[k])) throw err(`${k} must be an uploaded image`);
    return o;
  });
}
// Arabic project text: only translatable fields, length-limited; unknown slugs are ignored.
function cleanArProjects(a, known) {
  if (!Array.isArray(a) || a.length > 200) throw err('Invalid projects list');
  return a.filter(p => p && typeof p === 'object' && known.has(p.slug)).map(p => {
    const o = { slug: p.slug };
    for (const k of ['title', 'client', 'summary', 'overview', 'approach']) { const v = p[k]; if (v == null) continue; if (typeof v !== 'string' || v.length > 4000) throw err(`Field "${k}" is invalid or too long`); o[k] = v; }
    for (const k of ['services', 'goals', 'challenges', 'outcomes']) { const v = p[k]; if (v == null) continue; if (!Array.isArray(v) || v.length > 30 || v.some(x => x != null && (typeof x !== 'string' || x.length > 500))) throw err(`Field "${k}" is invalid`); o[k] = v; }
    return o;
  });
}
function saveContent(file, data) {
  const f = path.join(R, 'content', file), old = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  fs.writeFileSync(f, JSON.stringify(data, null, 2));
  const revert = () => { if (old === null) fs.rmSync(f, { force: true }); else fs.writeFileSync(f, old); try { build(); } catch { /* keep old build */ } };
  try { if (build()) throw err('A link or image points to a file that does not exist. Change reverted.'); }
  catch (e) { revert(); throw e.pub ? e : err('That change could not be built: ' + e.message); }
  refreshCsp();
}
const HEXC = /^#[0-9a-fA-F]{6}$/;
function checkSite(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || JSON.stringify(d).length > 3e5) throw err('Invalid settings');
  if (d.email && !EMAIL.test(d.email)) throw err('Email address looks invalid');
  if (d.formEndpoint && !/^https:\/\//.test(d.formEndpoint)) throw err('Form endpoint must start with https://');
  if (d.siteUrl && !/^https?:\/\//.test(d.siteUrl)) throw err('Site URL must start with https://');
  if (d.theme) { for (const k of ['background', 'primary', 'accent', 'surface', 'text']) if (d.theme[k] !== undefined && !HEXC.test(d.theme[k])) throw err('Theme colors must be 6-digit hex values.'); }
  for (const k of ['image', 'mobileImage']) if (d.hero && d.hero[k] && !/^\/assets\/img\/[\w./-]+$/.test(d.hero[k])) throw err('Hero images must be uploaded images.');
  const bad = x => !x || typeof x.label !== 'string' || x.label.length > 120 || typeof x.href !== 'string' || !/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/.test(x.href);
  for (const k of ['nav', 'legal']) if (d[k] && (!Array.isArray(d[k]) || d[k].length > 30 || d[k].some(bad))) throw err(`Invalid ${k} links.`);
  if (d.cta && d.cta.href && !/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/.test(d.cta.href)) throw err('Invalid call-to-action link.');
  if (d.marquee) {
    if (typeof d.marquee !== 'object' || Array.isArray(d.marquee)) throw err('Invalid moving strip settings.');
    if (d.marquee.speed !== undefined && !['slow', 'normal', 'fast'].includes(d.marquee.speed)) throw err('Moving strip speed must be slow, normal or fast.');
    if (d.marquee.items !== undefined && (!Array.isArray(d.marquee.items) || d.marquee.items.length > 40 || d.marquee.items.some(x => typeof x !== 'string' || x.length > 120))) throw err('Moving strip items are invalid.');
  }
  if (d.contactPage) { if (JSON.stringify(d.contactPage).length > 30000) throw err('Contact page settings are too large.'); const c = d.contactPage; if (c.channels && (!Array.isArray(c.channels) || c.channels.length > 20 || c.channels.some(x => !x || typeof x.label !== 'string' || x.label.length > 80 || typeof x.href !== 'string' || !/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/.test(x.href)))) throw err('Invalid contact channels.'); if (c.extraFields && (!Array.isArray(c.extraFields) || c.extraFields.length > 15)) throw err('You can add up to 15 extra form fields.'); for (const f of c.extraFields || []) { if (!f || typeof f.label !== 'string' || f.label.length > 100 || !['text', 'email', 'tel', 'url', 'number', 'textarea', 'select'].includes(f.type || 'text') || (f.options && (!Array.isArray(f.options) || f.options.length > 30))) throw err('Invalid additional contact field.'); } }
  return d;
}

// ---------- public contact form ----------
async function contact(req, res, ip) {
  if (L.contact.blocked(ip) || L.contactAll.blocked('*')) throw err('Too many inquiries from this connection. Please try again later.', 429);
  const ct = req.headers['content-type'] || '';
  if (!/^(application\/json|application\/x-www-form-urlencoded)\b/i.test(ct)) throw err('Unsupported content type', 415);
  const raw = (await body(req, 20000)).toString();
  let b; try { b = /json/i.test(ct) ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); if (!b || typeof b !== 'object' || Array.isArray(b)) throw 0; } catch { throw err('Invalid request'); }
  if (b._gotcha) return send(res, 200, { ok: true });
  const f = (k, max, req_) => { const v = String(b[k] ?? '').trim(); if (req_ && !v) throw err('Please complete all required fields.'); if (v.length > max) throw err(`"${k}" is too long.`); return v; };
  const lang = b.lang === 'ar' ? 'ar' : 'en';
  const q = { name: clean1(f('name', 120, 1)), email: f('email', 200, 1).toLowerCase(), company: clean1(f('company', 200, 1)), website: f('website', 300), service: clean1(f('service', 200, 1)), budget: clean1(f('budget', 100)), contact_method: clean1(f('contact_method', 50)), message: f('message', 5000, 1) };
  const enSite = rj(path.join(R, 'content/site.json'), {});
  const extraEn = enSite.contactPage?.extraFields || [], extraAr = I.resolveSite(enSite, rj(path.join(R, 'content/site.ar.json'), {}), 'ar').contactPage?.extraFields || [];
  const customFields = {};
  for (let i = 0; i < extraEn.length; i++) {
    const spec = extraEn[i], key = 'custom_' + i, v = String(b[key] ?? '').trim(), label = spec.label || ('Additional field ' + (i + 1));
    if (spec.required && !v) throw err(`Please complete: ${label}.`);
    if (v.length > 2000) throw err('An additional field is too long.');
    if (v && spec.type === 'email' && !EMAIL.test(v)) throw err(`Enter a valid email for ${label}.`);
    if (v && spec.type === 'url' && !/^https?:\/\//.test(v)) throw err(`${label} must start with http:// or https://.`);
    if (v && spec.type === 'select' && !(spec.options || []).includes(v) && !((extraAr[i] && extraAr[i].options) || []).includes(v)) throw err(`Choose a valid option for ${label}.`);
    if (v) customFields[key] = { label: String(label).slice(0, 100), value: v };
  }
  if (Object.keys(customFields).length) q.customFields = customFields;
  if (!EMAIL.test(q.email)) throw err('Please enter a valid email address.');
  if (q.website && !/^https?:\/\//.test(q.website)) throw err('Website must start with http:// or https://');
  if (q.message.length < 20) throw err('Please describe your project in at least 20 characters.');
  if (!b.consent) throw err('Please agree to be contacted.');
  L.contact.hit(ip); L.contactAll.hit('*');
  const all = rj(J('inquiries.json'), []);
  const lead = { id: crypto.randomBytes(8).toString('hex'), at: new Date().toISOString(), status: 'new', priority: 'normal', notes: '', lang, ...q };
  all.unshift(lead); wj(J('inquiries.json'), all.slice(0, 2000));
  auditEvent('lead.created', { leadId: lead.id });
  notifyLead(lead).catch(e => console.error('Email notification failed:', e.message));
  send(res, 200, { ok: true });
}

// ---------- optional transactional email (Resend) ----------
async function sendEmail(to, subject, html) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM || !to) return false;
  const response = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [to], subject: clean1(subject).slice(0, 200), html }), signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
  return true;
}
async function notifyLead(lead) {
  const notify = process.env.ADMIN_NOTIFY_EMAIL || process.env.ADMIN_EMAIL;
  const safe = v => String(v || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const E = I.DEF[lead.lang === 'ar' ? 'ar' : 'en'].email, rtl = lead.lang === 'ar' ? ' dir="rtl"' : '';
  const jobs = [sendEmail(notify, `New website inquiry from ${lead.name}`, `<h2>New inquiry</h2><p><b>${safe(lead.name)}</b> — ${safe(lead.company)}</p><p>${safe(lead.email)}</p><p>${safe(lead.service)} · ${safe(lead.budget)} · ${safe(lead.lang)}</p><p>${safe(lead.message)}</p>${lead.customFields ? Object.values(lead.customFields).map(v => `<p>${safe(v.label)}: ${safe(v.value)}</p>`).join('') : ''}`)];
  // The acknowledgement goes to an address typed by a stranger: send at most one per address per day and cap the total.
  if (L.ackTo.hit(lead.email) && L.ackAll.hit('*')) jobs.push(sendEmail(lead.email, E.subject, `<div${rtl}><p>${safe(E.hi.replace('{name}', lead.name))}</p><p>${safe(E.body)}</p><p>dev.commit</p></div>`));
  await Promise.all(jobs);
}

// ---------- privacy-friendly aggregate analytics (kept in memory, flushed to disk every 15 s) ----------
const analytics = rj(J('analytics.json'), { days: {} }); analytics.days ||= {};
let flushT = null;
const flushAnalytics = () => { clearTimeout(flushT); flushT = null; try { wj(J('analytics.json'), analytics); } catch (e) { console.error('Analytics save failed:', e.message); } };
function recordPageView(req, page) {
  const today = new Date().toISOString().slice(0, 10);
  const day = analytics.days[today] ||= { views: 0, pages: {}, referrers: {} };
  day.views++;
  const bump = (m, k, cap) => { if (!(k in m) && Object.keys(m).length >= cap) k = '(other)'; m[k] = (m[k] || 0) + 1; };
  bump(day.pages, page.slice(0, 180) || '/', 300);
  let source = 'direct'; try { const h = new URL(req.headers.referer || '').hostname.replace(/^www\./, '').toLowerCase(); if (/^[a-z0-9.-]{1,100}$/.test(h)) source = h; } catch { /* no referrer */ }
  bump(day.referrers, source, 200);
  const keys = Object.keys(analytics.days).sort(); for (const k of keys.slice(0, Math.max(0, keys.length - 90))) delete analytics.days[k];
  if (!flushT) flushT = setTimeout(flushAnalytics, 15000).unref();
}

// ---------- admin API ----------
const IMGCOUNT_MAX = 500;
async function admin(req, res, r, ip, lang) {
  if (r === 'login' && req.method === 'POST') return login(req, res, ip);
  const s = session(req);
  if (!s) throw err('Not signed in', 401);
  if (r === 'me') { const a = getAdmin() || {}; return send(res, 200, { email: s.email, csrf: s.csrf, totp: !!a.totp, recoveryLeft: a.totp ? (a.totp.recovery || []).length : 0 }); }
  const m = req.method;
  if (m !== 'GET' && !SEC.safeEqual(req.headers['x-csrf'] || '', s.csrf)) throw err('Security check failed. Reload the page.', 403);
  if (r === 'logout' && m === 'POST') { auditEvent('admin.logout', { email: s.email }); sess.delete(cookieOf(req)); return send(res, 200, { ok: true }, { 'Set-Cookie': cookieStr(req, '', 0) }); }
  const enSite = () => rj(path.join(R, 'content/site.json'), {}), enProjects = () => rj(path.join(R, 'content/projects.json'), []);
  if (r === 'projects') {
    if (m === 'GET') return send(res, 200, lang === 'ar' ? I.mergeProjects(enProjects(), rj(path.join(R, 'content/projects.ar.json'), {})) : enProjects());
    if (m === 'PUT') {
      if (lang === 'ar') { const en = enProjects(); saveContent('projects.ar.json', I.packProjects(en, cleanArProjects(await jbody(req), new Set(en.map(p => p.slug))))); }
      else saveContent('projects.json', cleanProjects(await jbody(req)));
      auditEvent('content.projects_saved', { lang }); return send(res, 200, { ok: true });
    }
  }
  if (r === 'site') {
    if (m === 'GET') return send(res, 200, I.resolveSite(enSite(), lang === 'ar' ? rj(path.join(R, 'content/site.ar.json'), {}) : null, lang));
    if (m === 'PUT') {
      const d = await jbody(req, 4e5);
      if (lang === 'ar') saveContent('site.ar.json', I.packSite(enSite(), d, 'ar'));
      else saveContent('site.json', I.packSite(null, checkSite(d), 'en'));
      auditEvent('content.site_saved', { lang }); return send(res, 200, { ok: true });
    }
  }
  if (r === 'inquiries' && m === 'GET') return send(res, 200, rj(J('inquiries.json'), []));
  if (r.startsWith('inquiries/') && m === 'PATCH') {
    const id = r.slice(10), b = await jbody(req, 12000), all = rj(J('inquiries.json'), []), q = all.find(x => x.id === id);
    if (!q) throw err('Lead not found', 404);
    if (b.status !== undefined) { if (!['new', 'contacted', 'qualified', 'converted', 'archived'].includes(b.status)) throw err('Invalid lead status'); q.status = b.status; }
    if (b.priority !== undefined) { if (!['low', 'normal', 'high'].includes(b.priority)) throw err('Invalid priority'); q.priority = b.priority; }
    if (b.notes !== undefined) { if (typeof b.notes !== 'string' || b.notes.length > 4000) throw err('Notes are too long'); q.notes = b.notes; }
    wj(J('inquiries.json'), all); auditEvent('lead.updated', { leadId: id }); return send(res, 200, { ok: true, lead: q });
  }
  if (r === 'clients' && m === 'GET') return send(res, 200, rj(J('clients.json'), []));
  if (r === 'clients' && m === 'POST') {
    const b = await jbody(req, 12000), val = (k, max = 200) => { const v = String(b[k] || '').trim(); if (v.length > max) throw err(`${k} is too long`); return v; };
    const client = { id: crypto.randomBytes(8).toString('hex'), createdAt: new Date().toISOString(), name: val('name'), email: val('email'), company: val('company'), phone: val('phone', 50), website: val('website', 300), notes: val('notes', 4000) };
    if (!client.name || !client.email || !EMAIL.test(client.email)) throw err('A valid client name and email are required.');
    const all = rj(J('clients.json'), []); all.unshift(client); wj(J('clients.json'), all.slice(0, 2000)); auditEvent('client.created', { clientId: client.id }); return send(res, 201, client);
  }
  if (r.startsWith('clients/') && (m === 'PATCH' || m === 'DELETE')) {
    const id = r.slice(8), all = rj(J('clients.json'), []), index = all.findIndex(x => x.id === id); if (index < 0) throw err('Client not found', 404);
    if (m === 'DELETE') { all.splice(index, 1); wj(J('clients.json'), all); auditEvent('client.deleted', { clientId: id }); return send(res, 200, { ok: true }); }
    const b = await jbody(req, 12000), q = all[index];
    for (const k of ['name', 'email', 'company', 'phone', 'website', 'notes']) if (b[k] !== undefined) { if (typeof b[k] !== 'string' || b[k].length > (k === 'notes' ? 4000 : 300)) throw err(`Invalid ${k}`); q[k] = b[k].trim(); }
    if (!q.name || !EMAIL.test(q.email)) throw err('A valid client name and email are required.');
    wj(J('clients.json'), all); auditEvent('client.updated', { clientId: id }); return send(res, 200, q);
  }
  if (r === 'analytics' && m === 'GET') return send(res, 200, analytics);
  if (r === 'audit' && m === 'GET') return send(res, 200, audit);
  if (r === 'export' && m === 'GET') {
    const rows = rj(J('inquiries.json'), []), keys = ['at', 'name', 'email', 'company', 'service', 'budget', 'lang', 'status', 'priority', 'message', 'customFields', 'notes'];
    const csv = [keys.join(','), ...rows.map(x => keys.map(k => SEC.csvCell(k === 'customFields' ? JSON.stringify(x[k] || {}) : x[k])).join(','))].join('\r\n');
    auditEvent('leads.exported', { count: rows.length });
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="devcommit-leads.csv"', 'Cache-Control': 'no-store', ...HEADERS }); return res.end(csv);
  }
  if (r.startsWith('inquiries/') && m === 'DELETE') { const id = r.slice(10); wj(J('inquiries.json'), rj(J('inquiries.json'), []).filter(x => x.id !== id)); auditEvent('lead.deleted', { leadId: id }); return send(res, 200, { ok: true }); }
  if (r === 'images' && m === 'GET') { let l = []; try { l = fs.readdirSync(IMG).filter(x => /\.(jpe?g|png|webp)$/i.test(x)).map(x => '/assets/img/projects/' + x); } catch { /* none yet */ } return send(res, 200, l); }
  if (r === 'upload' && m === 'POST') {
    const buf = await body(req, 6 * 1024 * 1024);
    if (!buf.length) throw err('Upload a JPG, PNG or WebP image (max 6 MB).');
    // The file type comes from the file's own bytes, never from the name the browser claims.
    const magic = buf.subarray(0, 4).toString('hex');
    const ext = magic.startsWith('ffd8ff') ? 'jpg' : magic === '89504e47' && buf.subarray(4, 8).toString('hex') === '0d0a1a0a' ? 'png' : magic === '52494646' && buf.subarray(8, 12).toString() === 'WEBP' ? 'webp' : '';
    if (!ext) throw err('That file is not a valid JPG, PNG or WebP image.');
    let count = 0; try { count = fs.readdirSync(IMG).length; } catch { /* none yet */ }
    if (count >= IMGCOUNT_MAX) throw err('Image library is full. Remove unused images first.');
    const base = String(req.headers['x-filename'] || 'image').replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
    const name = `${base}-${crypto.randomBytes(3).toString('hex')}.${ext}`;
    fs.mkdirSync(IMG, { recursive: true }); fs.writeFileSync(path.join(IMG, name), buf);
    fs.mkdirSync(path.join(DIST, 'assets/img/projects'), { recursive: true }); fs.copyFileSync(path.join(IMG, name), path.join(DIST, 'assets/img/projects', name));
    auditEvent('image.uploaded', { file: name });
    return send(res, 200, { path: '/assets/img/projects/' + name });
  }
  if (r === 'password' && m === 'POST') {
    const b = await jbody(req, 4096), a = getAdmin();
    if (L.loginFail.blocked(ip)) throw err('Too many attempts. Try again in 15 minutes.', 429);
    if (!(await SEC.checkPassword(String(b.current || ''), a))) { L.loginFail.hit(ip); throw err('Current password is incorrect.', 401); }
    const problem = SEC.passwordProblem(b.next); if (problem) throw err(problem);
    wj(J('admin.json'), { ...a, ...(await SEC.makePasswordRecord(b.next)) });
    auditEvent('admin.password_changed', { email: s.email });
    sess.clear();
    return send(res, 200, { ok: true }, { 'Set-Cookie': cookieStr(req, '', 0) });
  }
  // ----- two-factor authentication -----
  if (r === '2fa/setup' && m === 'POST') {
    const b = await jbody(req, 4096), a = getAdmin();
    if (L.loginFail.blocked(ip)) throw err('Too many attempts. Try again in 15 minutes.', 429);
    if (!(await SEC.checkPassword(String(b.password || ''), a))) { L.loginFail.hit(ip); throw err('Password is incorrect.', 401); }
    s.pendingTotp = SEC.newTotpSecret();
    return send(res, 200, { secret: s.pendingTotp, uri: SEC.totpUri(s.pendingTotp, a.email) });
  }
  if (r === '2fa/enable' && m === 'POST') {
    const b = await jbody(req, 1024), a = getAdmin();
    if (!s.pendingTotp) throw err('Start the setup again.');
    if (L.loginFail.blocked(ip)) throw err('Too many attempts. Try again in 15 minutes.', 429);
    const step = SEC.totpCheck(s.pendingTotp, b.code, 0);
    if (step < 0) { L.loginFail.hit(ip); throw err('That code is not correct. Check the time on your phone and try again.', 401); }
    const rec = SEC.newRecoveryCodes();
    wj(J('admin.json'), { ...a, totp: { secret: s.pendingTotp, lastStep: step, recovery: rec.hashed, enabledAt: new Date().toISOString() } });
    delete s.pendingTotp; auditEvent('admin.2fa_enabled', { email: s.email });
    return send(res, 200, { ok: true, recovery: rec.plain });
  }
  if (r === '2fa/disable' && m === 'POST') {
    const b = await jbody(req, 4096), a = getAdmin();
    if (!a.totp) throw err('Two-factor authentication is not enabled.');
    if (L.loginFail.blocked(ip)) throw err('Too many attempts. Try again in 15 minutes.', 429);
    if (!(await SEC.checkPassword(String(b.password || ''), a)) || !secondFactor(a, b.code)) { L.loginFail.hit(ip); throw err('Password or code is incorrect.', 401); }
    const { totp, ...rest } = getAdmin(); wj(J('admin.json'), rest);
    auditEvent('admin.2fa_disabled', { email: s.email });
    return send(res, 200, { ok: true });
  }
  throw err('Not found', 404);
}

// ---------- files ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.woff': 'font/woff', '.woff2': 'font/woff2' };
function adminFile(res, p) {
  const f = { '/admin': 'index.html', '/admin/': 'index.html', '/admin/admin.js': 'admin.js', '/admin/admin.css': 'admin.css' }[p];
  if (!f) throw err('Not found', 404);
  const buf = fs.readFileSync(path.join(ADMIN, f));
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)], 'Content-Length': buf.length, ...HEADERS, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Security-Policy': CSP });
  res.end(buf);
}
function staticFile(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.setHeader('Allow', 'GET, HEAD'); throw err('Method not allowed', 405); }
  if (p.includes('\0') || /(^|\/)\.(?!well-known(\/|$))/.test(p)) throw err('Not found', 404);
  let f = path.join(DIST, path.normalize(p)), code = 200;
  const rel = path.relative(DIST, f); if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw err('Not found', 404);
  try { if (fs.statSync(f).isDirectory()) f = path.join(f, 'index.html'); fs.accessSync(f); } catch { code = 404; f = path.join(DIST, p === '/ar' || p.startsWith('/ar/') ? 'ar/404.html' : '404.html'); }
  const ext = path.extname(f), isHtml = ext === '.html';
  if (code === 200 && isHtml && req.method === 'GET') recordPageView(req, '/' + path.relative(DIST, f).replace(/(^|\/)index\.html$/, '$1').replace(/\\/g, '/'));
  const buf = fs.readFileSync(f);
  const h = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': buf.length, ...HEADERS };
  if (isHtml) { h['Content-Security-Policy'] = CSP; h['Cache-Control'] = 'no-cache'; if (code === 404) h['X-Robots-Tag'] = 'noindex'; }
  else h['Cache-Control'] = p.startsWith('/assets/fonts/') ? 'public, max-age=31536000, immutable' : p.startsWith('/assets/') ? 'public, max-age=3600' : 'no-cache';
  res.writeHead(code, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

const server = http.createServer(async (req, res) => {
  try {
    let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { throw err('Bad request', 400); }
    const ip = ipOf(req);
    if (PROD && TRUST && req.headers['x-forwarded-proto'] === 'http') { const host = SITE_HOST || String(req.headers.host || '').toLowerCase(); if (/^[a-z0-9.:-]+$/.test(host)) { res.writeHead(301, { Location: 'https://' + host + req.url, ...HEADERS }); return res.end(); } }
    if (!L.req.hit(ip)) { res.setHeader('Retry-After', '60'); throw err('Too many requests', 429); }
    if (p === '/api/contact' && req.method === 'POST') { if (!sameSite(req)) throw err('Forbidden', 403); return await contact(req, res, ip); }
    const isAdmin = p === '/admin' || p.startsWith('/admin/') || p.startsWith('/api/admin/');
    if (isAdmin && ADMIN_IPS.length && !ADMIN_IPS.includes(ip)) throw err('Not found', 404);
    if (p.startsWith('/api/admin/')) {
      if (!L.api.hit(ip)) { res.setHeader('Retry-After', '60'); throw err('Too many requests', 429); }
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameSite(req)) throw err('Forbidden', 403);
      const lang = new URL(req.url, 'http://x').searchParams.get('lang') === 'ar' ? 'ar' : 'en';
      return await admin(req, res, p.slice(11), ip, lang);
    }
    if (p.startsWith('/api/')) throw err('Not found', 404);
    if (isAdmin) return adminFile(res, p);
    staticFile(req, res, p);
  } catch (e) {
    if (!e.pub) console.error(e);
    if (!res.headersSent) {
      if (e.status === 413) { res.setHeader('Connection', 'close'); res.on('finish', () => req.socket.destroy()); }
      send(res, e.status || 500, { error: e.pub ? e.message : 'Server error' });
    }
  }
});

server.headersTimeout = 10000; server.requestTimeout = 30000; server.keepAliveTimeout = 5000; server.maxHeadersCount = 60;
server.maxRequestsPerSocket = 200; server.maxConnections = 1500;
server.on('clientError', (e, sock) => { if (sock.writable) sock.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else sock.destroy(); });

// A crash would be a denial of service: log unexpected errors and keep serving.
process.on('uncaughtException', e => console.error('Uncaught exception:', e));
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flushAnalytics(); server.close(); setTimeout(() => process.exit(0), 200).unref(); });
process.on('exit', () => { if (flushT) flushAnalytics(); });

refreshCsp();
ensureAdmin().catch(e => console.error('Admin setup failed:', e.message));
build();
let t; for (const d of ['content', 'assets']) { try { fs.watch(path.join(R, d), { recursive: true }, () => { clearTimeout(t); t = setTimeout(() => { try { build(); refreshCsp(); } catch (e) { console.error('Build failed:', e.message); } }, 300); }); } catch { /* watching unsupported */ } }
if (PROD && !TRUST && !SITE_HOST) console.warn('Tip: behind HTTPS proxy set TRUST_PROXY=1 and SITE_URL so cookies are marked Secure and rate limits see real client IPs.');
server.listen(PORT, HOST, () => console.log(`Site:  http://localhost:${PORT}\nAdmin: http://localhost:${PORT}/admin`));

'use strict';
// Security helpers shared by server.js and create-admin.js. No dependencies.
const crypto = require('crypto');

// ---------- password hashing (scrypt, async, versioned parameters) ----------
const KDF_NEW = { N: 1 << 15, r: 8, p: 1 };      // ~32 MiB per hash
const KDF_LEGACY = { N: 1 << 14, r: 8, p: 1 };   // what the first version stored (no params field)
const scryptAsync = (pw, salt, k) => new Promise((ok, no) =>
  crypto.scrypt(String(pw).slice(0, 256), salt, 64, { N: k.N, r: k.r, p: k.p, maxmem: 128 * 1024 * 1024 }, (e, d) => (e ? no(e) : ok(d))));

// Limit concurrent hashes so a flood of login attempts cannot exhaust memory/CPU.
let inflight = 0;
async function hashPassword(pw, saltHex, kdf = KDF_NEW) {
  if (inflight >= 3) { const e = new Error('Server busy, try again shortly.'); e.status = 503; e.pub = true; throw e; }
  inflight++;
  try { return await scryptAsync(pw, saltHex, kdf); } finally { inflight--; }
}
async function makePasswordRecord(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return { salt, hash: (await hashPassword(pw, salt)).toString('hex'), kdf: KDF_NEW };
}
async function checkPassword(pw, rec) {
  const h = await hashPassword(pw, rec.salt, rec.kdf || KDF_LEGACY);
  const want = Buffer.from(rec.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
const needsRehash = rec => !rec.kdf || rec.kdf.N < KDF_NEW.N;

// A password is rejected if it is short or one of the most common choices.
const COMMON = new Set(['password1234', '123456789012', 'qwertyuiop12', 'adminadmin12', 'devcommit1234', 'welcome12345', 'letmein12345', 'iloveyou1234']);
function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must be at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common.';
  if (new Set(pw).size < 6) return 'Password is too repetitive.';
  return '';
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32encode(buf) {
  let bits = 0, val = 0, out = '';
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32decode(s) {
  let bits = 0, val = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) { val = (val << 5) | B32.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
const newTotpSecret = () => b32encode(crypto.randomBytes(20));
function totpAt(secret, step) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String(((h[o] & 127) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0');
}
// Returns the matching time step (so the caller can refuse replays) or -1.
function totpCheck(secret, code, lastStep = 0) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return -1;
  const now = Math.floor(Date.now() / 30000);
  for (const d of [0, -1, 1]) {
    const step = now + d;
    if (step > lastStep && safeEqual(totpAt(secret, step), code)) return step;
  }
  return -1;
}
const totpUri = (secret, email, issuer = 'dev.commit') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// ---------- recovery codes ----------
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
function newRecoveryCodes(n = 8) {
  const plain = Array.from({ length: n }, () => { const x = crypto.randomBytes(5).toString('hex'); return x.slice(0, 5) + '-' + x.slice(5); });
  return { plain, hashed: plain.map(sha) };
}
const normRecovery = c => String(c || '').trim().toLowerCase().replace(/[^0-9a-f]/g, '').replace(/^(.{5})(.{5})$/, '$1-$2');

function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---------- Content-Security-Policy ----------
// Pages ship no inline script or style, so both can be locked to 'self'.
function csp({ formOrigin = '', production = false } = {}) {
  const ext = formOrigin ? ' ' + formOrigin : '';
  return [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "font-src 'self'",
    "connect-src 'self'" + ext, "form-action 'self'" + ext, "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'",
    ...(production ? ['upgrade-insecure-requests'] : [])
  ].join('; ');
}

// ---------- small in-memory rate limiter ----------
class Limiter {
  constructor(max, windowMs, cap = 20000) { this.max = max; this.win = windowMs; this.cap = cap; this.m = new Map(); }
  // Counts this call and returns true if the caller is still within the limit.
  hit(key) {
    const now = Date.now(); let a = this.m.get(key);
    if (!a) { if (this.m.size >= this.cap) this.m.delete(this.m.keys().next().value); a = []; this.m.set(key, a); }
    while (a.length && now - a[0] > this.win) a.shift();
    if (a.length >= this.max) return false;
    a.push(now); return true;
  }
  // Counts nothing; true if the key has already reached the limit.
  blocked(key) {
    const a = this.m.get(key); if (!a) return false;
    const now = Date.now(); while (a.length && now - a[0] > this.win) a.shift();
    return a.length >= this.max;
  }
  clear(key) { this.m.delete(key); }
  sweep() { const now = Date.now(); for (const [k, a] of this.m) { while (a.length && now - a[0] > this.win) a.shift(); if (!a.length) this.m.delete(k); } }
}

// Spreadsheet programs run cells that start with = + - @ as formulas; neutralise them in CSV exports.
const csvCell = v => { let s = String(v ?? '').replace(/[\r\n]+/g, ' '); if (/^[=+\-@\t]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };

module.exports = { KDF_NEW, hashPassword, makePasswordRecord, checkPassword, needsRehash, passwordProblem, newTotpSecret, totpCheck, totpUri, newRecoveryCodes, normRecovery, sha, safeEqual, csp, Limiter, csvCell };

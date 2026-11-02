'use strict';
// Usage: npm run create-admin
// Creates or resets the admin login. The password is stored only as a salted scrypt hash.
// Resetting also switches off two-factor authentication (this is the recovery path if the phone is lost,
// and it needs shell access to the server, which is the point).
const fs = require('fs'), path = require('path'), readline = require('readline');
const SEC = require('./lib/security.js');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
let mute = false;
rl._writeToOutput = s => { if (!mute) process.stdout.write(s); else if (s.includes('\n')) process.stdout.write('\n'); };
const ask = (q, hide) => new Promise(ok => { rl.question(q, a => { mute = false; ok(a); }); mute = !!hide; });

(async () => {
  const email = ((await ask('Admin email [devcommitt@gmail.com]: ')).trim() || 'devcommitt@gmail.com').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.error('Invalid email.'); process.exit(1); }
  const p1 = await ask('New password (min 12 characters): ', true);
  const p2 = await ask('Repeat password: ', true);
  rl.close();
  const problem = SEC.passwordProblem(p1);
  if (problem) { console.error(problem); process.exit(1); }
  if (p1 !== p2) { console.error('Passwords do not match.'); process.exit(1); }
  const file = path.join(__dirname, 'data/admin.json');
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ email, ...(await SEC.makePasswordRecord(p1)) }, null, 2), { mode: 0o600 });
  console.log(`Admin account saved for ${email}. Two-factor authentication is off; enable it again under Account. Restart the server if it is running.`);
})();

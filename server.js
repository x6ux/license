const https = require('https');
const http = require('http');
const crypto = require('crypto');

// ───── إعدادات الرخصة ─────
const API_URL = 'https://baptist-pounds-including-heath.trycloudflare.com/verify'; // رابط الـ API
const PRODUCT = 'drm-files';              // اسم المنتج المطابق للرخصة
const RECHECK_MS = 10 * 60 * 1000;        // إعادة الفحص كل 10 دقائق
const MAX_FAILS = 3;                      // عدد فشل الاتصال المسموح أثناء التشغيل
const CLOSE_DELAY_SEC = 10;               // كم ثانية يظهر الخطأ قبل التنفيذ
// 'hold' = يوقف كل الريسورسات ويطرد اللاعبين ويخلي الـ CMD مفتوح وفيه الخطأ
// 'quit' = يقفل السيرفر والـ CMD كامل
const STOP_MODE = 'hold';
// ─────────────────────────

// المفتاح العام: انسخ ملف signing_public.pem من مجلد البوت وحطه بجنب هذا الملف
// (أو الصق المفتاح هنا بدل PASTE_PUBLIC_KEY_HERE)
let PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
PASTE_PUBLIC_KEY_HERE
-----END PUBLIC KEY-----`;
if (PUBLIC_KEY.includes('PASTE_PUBLIC_KEY_HERE')) {
  const f = LoadResourceFile(GetCurrentResourceName(), 'signing_public.pem');
  if (f) PUBLIC_KEY = f;
}

// Optional: api_url.txt next to this file overrides API_URL (re-read on every check, so a changed tunnel URL needs no restart)
function getApiUrl() {
  try {
    const f = LoadResourceFile(GetCurrentResourceName(), 'api_url.txt');
    if (f && f.trim().startsWith('http')) return f.trim();
  } catch {}
  return API_URL;
}

const KEY = GetConvar('dreams_license', '');
let licensed = false;
let closing = false;
let netFails = 0;

const red = (s) => console.log(`\x1b[31m${s}\x1b[0m`);
const green = (s) => console.log(`\x1b[32m${s}\x1b[0m`);
const maskKey = (k) => (k ? k.slice(0, 8) + '****' : '(none)');
// short fingerprint of the public key (same value is printed in the bot console, so you can compare them)
const keyFingerprint = () => {
  try {
    const der = crypto.createPublicKey(PUBLIC_KEY).export({ type: 'spki', format: 'der' });
    return crypto.createHash('sha256').update(der).digest('hex').slice(0, 12);
  } catch { return 'unreadable (bad signing_public.pem)'; }
};

// Shows a clear error banner, keeps it on screen with a countdown, then stops the server.
function shutdown(title, text, extra = []) {
  if (closing) return;
  closing = true;
  licensed = false;
  let left = CLOSE_DELAY_SEC;

  const banner = (footer) => {
    console.log('');
    red('==================================================');
    red('  LICENSE ERROR: ' + title);
    if (text) red('  ' + text);
    for (const l of extra) red('  ' + l);
    red('  ' + footer);
    red('  Flux Team | ' + CREDITS.join(' | '));
    red('==================================================');
  };

  // hold mode: stop every resource, kick players, keep the console open on the error
  const hold = () => {
    try { for (const id of GetPlayers()) DropPlayer(id, 'License error: ' + title); } catch {}
    try {
      const self = GetCurrentResourceName();
      const n = GetNumResources();
      for (let i = 0; i < n; i++) {
        const name = GetResourceByFindIndex(i);
        if (name && name !== self && name !== 'monitor' && GetResourceState(name) === 'started')
          ExecuteCommand(`stop ${name}`);
      }
    } catch {}
    banner('SERVER STOPPED - fix the license problem and restart the server');
    setInterval(() => banner('SERVER STOPPED - fix the license problem and restart the server'), 5000);
  };

  banner(`Server will stop in ${left} seconds...`);
  const timer = setInterval(() => {
    left--;
    if (left <= 0) {
      clearInterval(timer);
      if (STOP_MODE === 'quit') {
        ExecuteCommand('quit');
        setTimeout(() => process.exit(1), 1500);
      } else hold();
      return;
    }
    if (left % 3 === 0) banner(`Server will stop in ${left} seconds...`); // re-print so other logs don't push it away
    else red(`[License] Stopping in ${left}...`);
  }, 1000);
}

// Credits + big success banner, printed after the server finished starting its resources
const BIG_TEXT = [
  '█████ █     █   █ █   █    █████ █████  ███  █   █',
  '█     █     █   █  █ █       █   █     █   █ ██ ██',
  '████  █     █   █   █        █   ████  █████ █ █ █',
  '█     █     █   █  █ █       █   █     █   █ █   █',
  '█     █████  ███  █   █      █   █████ █   █ █   █',
];
const CREDITS = ['Made By : itsUae', 'https://discord.gg/d-0'];

function showSuccessBanner(info) {
  console.log('');
  green('################################################################');
  console.log('');
  for (const l of BIG_TEXT) green('        ' + l);
  console.log('');
  green('        YOUR LICENSE IS ACTIVE AND VERIFIED SUCCESSFULLY');
  console.log('');
  green(`        Product : ${PRODUCT}`);
  green(`        License : ${maskKey(KEY)}`);
  // green(`        Server IP: ${info.ip || 'unknown'}`);
  console.log('');
  for (const l of CREDITS) green('        ' + l);
  console.log('');
  green('################################################################');
  console.log('');
}

// waits until no resource is still "starting" (3 seconds in a row), max 90 seconds
function afterStartup(cb) {
  let quiet = 0, waited = 0;
  const t = setInterval(() => {
    waited++;
    let starting = 0;
    try {
      const n = GetNumResources();
      for (let i = 0; i < n; i++) if (GetResourceState(GetResourceByFindIndex(i)) === 'starting') starting++;
    } catch {}
    quiet = starting === 0 ? quiet + 1 : 0;
    if (quiet >= 3 || waited >= 90) { clearInterval(t); cb(); }
  }, 1000);
}

function verify(initial) {
  return new Promise((resolve) => {
    const nonce = crypto.randomBytes(16).toString('hex');
    const body = JSON.stringify({ key: KEY, product: PRODUCT, nonce, startup: initial === true });
    const url = new URL(getApiUrl());
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'POST',
      timeout: 8000,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          let sigOk = false;
          try {
            sigOk = crypto.verify(null, Buffer.from(`${r.ok}|${nonce}|${r.ts}|${KEY}`), PUBLIC_KEY, Buffer.from(String(r.sig || ''), 'hex'));
          } catch { sigOk = false; }
          const fresh = Math.abs(Date.now() - r.ts) < 30000;
          resolve({ net: true, sigOk, fresh, diff: Math.abs(Date.now() - r.ts), ok: r.ok === true, reason: r.reason, ip: r.ip });
        } catch {
          resolve({ net: false });
        }
      });
    });
    req.on('error', () => resolve({ net: false }));
    req.on('timeout', () => { req.destroy(); resolve({ net: false }); });
    req.write(body);
    req.end();
  });
}

const reasons = {
  wrong_ip: 'This server IP is not activated for this license',
  ip_not_activated: 'No IP is activated - activate it from the Discord license panel',
  private_ip: 'License server sees a local IP - the API owner must set TRUST_PROXY correctly',
  invalid_key: 'The license key is invalid',
  revoked: 'License revoked by administration',
  stopped: 'License stopped - re-enable it from the Discord license panel',
  expired: 'License expired',
  wrong_product: 'This license belongs to a different product',
  not_claimed: 'License not activated yet - activate your key from the Discord license panel first',
  blacklisted: 'This IP is blacklisted',
};
const ipReasons = new Set(['wrong_ip', 'ip_not_activated', 'private_ip', 'blacklisted']);

async function check(initial) {
  if (closing) return;
  if (!KEY) return shutdown('NO LICENSE KEY', 'Add to server.cfg:  set dreams_license "XXXX"');
  if (PUBLIC_KEY.includes('PASTE_PUBLIC_KEY_HERE'))
    return shutdown('SETUP ERROR', 'Public key missing: copy signing_public.pem into the license-system folder');

  const r = await verify(initial);
  if (!r.net) {
    netFails++;
    if (initial || netFails >= MAX_FAILS)
      return shutdown('CANNOT REACH LICENSE SERVER', 'Check API_URL in server.js and that the license bot/tunnel is running');
    return;
  }
  netFails = 0;
  if (!r.sigOk || !r.fresh) {
    const clockOnly = r.sigOk && !r.fresh;
    return shutdown('UNTRUSTED RESPONSE',
      clockOnly
        ? 'Signature is valid but the clocks differ too much - sync the Windows time on both machines'
        : 'Signature mismatch - signing_public.pem here does not match the bot (or the bot runs an old index.js)',
      [`Public key fingerprint (this server): ${keyFingerprint()}`,
       `Clock difference: ${Math.round((r.diff || 0) / 1000)}s`,
       'Compare the fingerprint with the one printed in the bot console']);
  }

  if (!r.ok) {
    const title = ipReasons.has(r.reason) ? 'WRONG IP' : 'INVALID LICENSE';
    return shutdown(title, reasons[r.reason] || r.reason, [
      `Reason code: ${r.reason}`,
      `IP seen by license server: ${r.ip || 'unknown'}`,
      `License key: ${maskKey(KEY)}`,
    ]);
  }
  if (initial) {
    green('[License] License and IP verified successfully');
    afterStartup(() => { if (licensed) showSuccessBanner(r); });
  }
  licensed = true;
}

check(true);
setInterval(() => check(false), RECHECK_MS);

exports('IsLicensed', () => licensed);

onNet('dreams_pack:server:executeAction', () => {
  const src = global.source;
  // Block execution if the license is not active
  if (!licensed) {
    console.log(`[License Security] Unauthorized action execution attempt by source ${src}`);
    return;
  }
});

setInterval(() => {
  if (!licensed) shutdown('INTEGRITY CHECK FAILED', 'License is not active');
}, 45000);
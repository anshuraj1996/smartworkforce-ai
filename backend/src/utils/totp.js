const crypto = require('crypto');

// Minimal RFC 6238 TOTP (same algorithm Google Authenticator/Authy use), built on
// Node's built-in crypto so we don't need an extra dependency for a small feature.

const STEP_SECONDS = 30;
const DIGITS = 6;

function generateSecret() {
  return crypto.randomBytes(20).toString('hex');
}

function hotp(secretHex, counter) {
  const key = Buffer.from(secretHex, 'hex');
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode = (hmac.readUInt32BE(offset) & 0x7fffffff) % (10 ** DIGITS);

  return binCode.toString().padStart(DIGITS, '0');
}

function generateTotp(secretHex, date = new Date()) {
  const counter = Math.floor(date.getTime() / 1000 / STEP_SECONDS);
  return hotp(secretHex, counter);
}

// Accept the current step and one step of clock drift on either side
function verifyTotp(secretHex, token, date = new Date()) {
  const counter = Math.floor(date.getTime() / 1000 / STEP_SECONDS);
  for (let drift = -1; drift <= 1; drift++) {
    if (hotp(secretHex, counter + drift) === token) return true;
  }
  return false;
}

// Authenticator apps expect the secret as base32 in the setup URI/manual-entry key,
// even though we keep it as hex internally for the HMAC math above.
function toBase32(secretHex) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = Buffer.from(secretHex, 'hex');
  let bits = 0, value = 0, output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

function buildAuthUri(secretHex, email, issuer = 'SmartWorkforce AI') {
  const base32Secret = toBase32(secretHex);
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${base32Secret}&issuer=${encodeURIComponent(issuer)}&digits=6&period=30`;
}

module.exports = { generateSecret, generateTotp, verifyTotp, buildAuthUri, toBase32 };

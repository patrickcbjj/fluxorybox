import crypto from 'node:crypto';
import { config } from './config.js';

function key() {
  return crypto.createHash('sha256').update(config.masterKey || 'dev-key').digest();
}

// Gera um token de sessão assinado (HMAC) — o usuário nunca vê isso.
export function signSession(username, days = 30) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + days * 86400000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifySession(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', key()).update(payload).digest('base64url');
  if (!sig || sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now()) return null;
    return p;
  } catch { return null; }
}

export function checkCredentials(username, password) {
  if (!config.appUser || !config.appPass) return false;
  const u = String(username || ''), p = String(password || '');
  // Comparação em tempo constante.
  const eq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  return eq(u, config.appUser) && eq(p, config.appPass);
}

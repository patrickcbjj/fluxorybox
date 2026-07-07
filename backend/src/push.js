// Envio de notificações via FCM HTTP v1 — SEM dependência externa.
// Autentica com a service account (JWT RS256 -> access_token OAuth) e posta no FCM.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { removePushToken } from './db.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Carrega a service account de: env FCM_SERVICE_ACCOUNT_B64 (base64 do JSON)
// ou arquivo backend/fcm-service-account.json.
function loadServiceAccount() {
  const b64 = process.env.FCM_SERVICE_ACCOUNT_B64;
  if (b64) {
    try { return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); }
    catch { console.warn('[push] FCM_SERVICE_ACCOUNT_B64 inválido.'); }
  }
  const file = path.join(ROOT, 'fcm-service-account.json');
  if (fs.existsSync(file)) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { console.warn('[push] fcm-service-account.json inválido.'); }
  }
  return null;
}

const sa = loadServiceAccount();
export const pushEnabled = !!sa;
if (!pushEnabled) console.warn('[push] FCM não configurado (sem service account) — notificações desativadas.');

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

let cachedToken = null;
let cachedExp = 0;

// Gera (ou reaproveita) um access_token OAuth2 pra escopo do FCM.
async function getAccessToken() {
  if (cachedToken && Date.now() < cachedExp - 60000) return cachedToken;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claim))}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key);
  const jwt = `${unsigned}.${b64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token FCM: ${data.error_description || data.error || res.status}`);
  cachedToken = data.access_token;
  cachedExp = Date.now() + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

// Envia uma notificação pra uma lista de tokens. Remove tokens inválidos do banco.
export async function sendPush(tokens, { title, body, data = {}, tag, group } = {}) {
  if (!pushEnabled || !tokens?.length) return { sent: 0, removed: 0 };
  let accessToken;
  try { accessToken = await getAccessToken(); }
  catch (e) { console.warn('[push] falha ao obter token:', e.message); return { sent: 0, removed: 0 }; }

  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  let sent = 0, removed = 0;
  // Data precisa ser string:string no FCM.
  const dataStr = {};
  for (const [k, v] of Object.entries(data)) dataStr[k] = String(v);

  await Promise.all(tokens.map(async (token) => {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            data: dataStr,
            android: {
              priority: 'high',
              notification: {
                channel_id: 'novos_emails',
                // tag: cada email é uma notificação própria (não sobrescreve outra conta).
                ...(tag ? { tag } : {}),
              },
            },
          },
        }),
      });
      if (res.ok) { sent++; return; }
      const err = await res.json().catch(() => ({}));
      const code = err?.error?.details?.[0]?.errorCode || err?.error?.status;
      // Token morto → limpa do banco.
      if (res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT') {
        removePushToken(token); removed++;
      }
    } catch (_) {/* rede — ignora */}
  }));
  return { sent, removed };
}

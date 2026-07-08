// IDLE watcher: mantém uma conexão IMAP por conta em IDLE e dispara push (FCM) no
// INSTANTE que chega email novo (~2-5s), em vez de esperar o poller de 3 min.
//
// CUIDADO abuse-mode (AADSTS70000): o perigo NÃO é a conexão aberta (isso é gentil —
// 1 login e fica de pé), é RECONECTAR em loop. Por isso: backoff exponencial com jitter,
// e só observa contas quando existe pelo menos um dispositivo registrado pra notificar.
import { ImapFlow } from 'imapflow';
import { listAccounts, getAccount, listPushTokens } from './db.js';
import { accessTokenFor } from './oauth.js';
import { sendPush, pushEnabled } from './push.js';
import { markHealthy, markUnhealthy } from './health.js';

const watchers = new Map(); // accountId -> { id, email, connected, client, maxUid, fails, stopped, timer }
const RECONNECT_BASE = 15000;         // 15s
const RECONNECT_MAX = 10 * 60 * 1000; // até 10 min entre tentativas

// O poller usa isso pra NÃO duplicar push de contas já observadas pelo IDLE.
export function isWatched(accountId) {
  const w = watchers.get(accountId);
  return !!(w && w.connected);
}

function senderName(env) {
  const f = (env.from && env.from[0]) || {};
  return f.name || f.address || 'Novo email';
}

async function onNewMail(w, client, account) {
  const tokens = listPushTokens();
  if (!tokens.length) return; // ninguém pra notificar
  // Respeita o toggle "notificar desta conta" (lê fresco do banco).
  const fresh = getAccount(w.id);
  if (fresh && fresh.notify === false) return;
  const from = w.maxUid + 1;
  const novos = [];
  for await (const msg of client.fetch({ uid: `${from}:*` },
      { uid: true, envelope: true, flags: true }, { uid: true })) {
    // IMAP: `n:*` com n>max devolve o último — filtra o que já vimos.
    if ((msg.uid || 0) <= w.maxUid) continue;
    novos.push(msg);
  }
  if (!novos.length) return;
  w.maxUid = Math.max(w.maxUid, ...novos.map((m) => m.uid || 0));
  for (const msg of novos.slice(-5)) {
    const flags = msg.flags;
    const seen = flags && (flags.has ? flags.has('\\Seen') : false);
    if (seen) continue; // já lido (ex.: mensagem que a própria conta enviou)
    const env = msg.envelope || {};
    await sendPush(tokens, {
      title: `${senderName(env)} — ${account.email}`,
      body: env.subject || '(sem assunto)',
      tag: `acct-${account.id}-${msg.uid}`,
      data: { accountId: String(account.id), accountEmail: account.email, uid: String(msg.uid), folder: 'INBOX' },
    });
  }
}

async function connectWatcher(w) {
  if (w.stopped) return;
  // Sem device registrado → nem conecta (o sync religa quando aparecer token).
  if (!listPushTokens().length) return;

  let account;
  try { account = getAccount(w.id, { withSecret: true }); } catch (_) { account = null; }
  if (!account) { watchers.delete(w.id); return; }

  try {
    const auth = account.authType === 'oauth'
      ? { user: account.email, accessToken: await accessTokenFor(account) }
      : { user: account.email, pass: account.password };
    const client = new ImapFlow({
      host: account.imap.host, port: account.imap.port, secure: account.imap.secure,
      auth, logger: false, tls: { rejectUnauthorized: false },
    });
    client.on('error', () => {}); // um 'error' sem listener derruba o processo
    w.client = client;
    await client.connect();
    const mbox = await client.mailboxOpen('INBOX');
    // Topo atual: só notifica o que CHEGAR depois disso.
    w.maxUid = mbox.uidNext ? mbox.uidNext - 1 : 0;
    w.connected = true;
    w.fails = 0;
    markHealthy(w.id);
    console.log(`[idle] observando ${account.email}`);

    client.on('exists', () => {
      onNewMail(w, client, account).catch(() => {/* o poller cobre como fallback */});
    });
    client.on('close', () => scheduleReconnect(w));
  } catch (e) {
    w.connected = false;
    markUnhealthy(w.id, e);
    console.warn(`[idle] falha ao observar ${w.email}: ${e.message}`);
    scheduleReconnect(w);
  }
}

function scheduleReconnect(w) {
  if (w.stopped || w.timer) return;
  w.connected = false;
  try { w.client?.close(); } catch (_) {}
  // Sem device? não fica reconectando à toa.
  if (!listPushTokens().length) return;
  w.fails = Math.min(w.fails + 1, 8);
  const delay = Math.min(RECONNECT_MAX, RECONNECT_BASE * 2 ** (w.fails - 1)) + Math.random() * 5000;
  console.warn(`[idle] ${w.email} reconecta em ${Math.round(delay / 1000)}s`);
  w.timer = setTimeout(() => { w.timer = null; connectWatcher(w); }, delay);
}

function startWatcher(account) {
  if (watchers.has(account.id)) return;
  const w = { id: account.id, email: account.email, connected: false, client: null, maxUid: 0, fails: 0, stopped: false, timer: null };
  watchers.set(account.id, w);
  connectWatcher(w);
}

export function stopWatcher(accountId) {
  const w = watchers.get(accountId);
  if (!w) return;
  w.stopped = true;
  if (w.timer) clearTimeout(w.timer);
  try { w.client?.logout(); } catch (_) {}
  watchers.delete(accountId);
}

// Reconcilia os watchers com as contas atuais (e desliga tudo se ninguém pra notificar).
function syncWatchers() {
  if (!listPushTokens().length) {
    for (const id of [...watchers.keys()]) stopWatcher(id);
    return;
  }
  const accounts = listAccounts();
  const ids = new Set(accounts.map((a) => a.id));
  for (const a of accounts) if (!watchers.has(a.id)) startWatcher(a);
  for (const id of [...watchers.keys()]) if (!ids.has(id)) stopWatcher(id);
}

// Chamado quando um device registra o token (liga o IDLE na hora, sem esperar o sync).
export function kickIdle() {
  if (pushEnabled) syncWatchers();
}

export function startIdle() {
  if (!pushEnabled) { console.log('[idle] push desativado — IDLE não iniciado.'); return; }
  console.log('[idle] iniciado (push instantâneo via IMAP IDLE).');
  syncWatchers();
  setInterval(syncWatchers, 5 * 60 * 1000).unref?.();
}

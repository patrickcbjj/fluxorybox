// Poller de novos emails: a cada 60s checa a INBOX de cada conta e dispara push
// (FCM) pros dispositivos registrados quando chega mensagem nova. Tudo na Discloud.
import { listAccounts, getAccount, listPushTokens } from './db.js';
import { listMessages } from './imap.js';
import { sendPush, pushEnabled } from './push.js';

const INTERVAL_MS = 60000;
const lastSeenUid = new Map(); // accountId -> maior UID já visto na INBOX
let running = false;

function senderName(msg) {
  const f = (msg.from && msg.from[0]) || {};
  return f.name || f.address || 'Novo email';
}

async function checkAccount(account) {
  const { messages } = await listMessages(account, { folder: 'INBOX', limit: 15 });
  if (!messages.length) return [];
  const maxUid = Math.max(...messages.map((m) => m.uid || 0));
  const prev = lastSeenUid.get(account.id);
  lastSeenUid.set(account.id, maxUid);
  // Primeira passada da conta: só memoriza o topo, não notifica o histórico.
  if (prev === undefined) return [];
  // Novos = UID maior que o último visto e ainda não lido.
  return messages
    .filter((m) => (m.uid || 0) > prev && m.seen !== true)
    .sort((a, b) => (a.uid || 0) - (b.uid || 0));
}

async function tick() {
  if (running || !pushEnabled) return;
  const tokens = listPushTokens();
  if (!tokens.length) return; // ninguém pra notificar
  running = true;
  try {
    const accounts = listAccounts();
    for (const a of accounts) {
      try {
        const full = getAccount(a.id, { withSecret: true });
        const novos = await checkAccount(full);
        for (const m of novos.slice(-5)) { // no máx 5 por conta/ciclo
          await sendPush(tokens, {
            title: senderName(m),
            body: m.subject || '(sem assunto)',
            data: { accountId: String(m.accountId), uid: String(m.uid), folder: 'INBOX' },
          });
        }
      } catch (_) {/* conta com erro (token expirado etc.) — ignora neste ciclo */}
    }
  } finally {
    running = false;
  }
}

export function startPoller() {
  if (!pushEnabled) {
    console.log('[poller] push desativado — poller não iniciado.');
    return;
  }
  console.log('[poller] iniciado (checando novos emails a cada 60s).');
  setInterval(tick, INTERVAL_MS);
}

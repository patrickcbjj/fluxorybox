// Poller de novos emails: checa periodicamente a INBOX de cada conta e dispara push
// (FCM) pros dispositivos registrados quando chega mensagem nova. Tudo na Discloud.
//
// IMPORTANTE: manter GENTIL. A Microsoft/Google flagam a conta em "service abuse mode"
// (AADSTS70000) se houver login/refresh demais. Por isso: intervalo folgado, cache de
// token (em oauth.js) e backoff exponencial nas contas que falham.
import { listAccounts, getAccount, listPushTokens } from './db.js';
import { listMessages } from './imap.js';
import { sendPush, pushEnabled } from './push.js';

const INTERVAL_MS = 180000;      // 3 min entre ciclos
const MAX_BACKOFF = 10;          // pula no máx 10 ciclos (~30 min) uma conta problemática
const lastSeenUid = new Map();   // accountId -> maior UID já visto na INBOX
const failStreak = new Map();    // accountId -> nº de falhas seguidas
const skipCycles = new Map();    // accountId -> ciclos restantes p/ pular
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
  if (prev === undefined) return []; // 1ª passada: só memoriza o topo
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
    for (const a of listAccounts()) {
      // Backoff: conta que vem falhando é pulada por alguns ciclos.
      const skip = skipCycles.get(a.id) || 0;
      if (skip > 0) { skipCycles.set(a.id, skip - 1); continue; }
      try {
        const full = getAccount(a.id, { withSecret: true });
        const novos = await checkAccount(full);
        failStreak.set(a.id, 0); // sucesso zera o streak
        for (const m of novos.slice(-5)) {
          await sendPush(tokens, {
            title: senderName(m),
            body: m.subject || '(sem assunto)',
            data: { accountId: String(m.accountId), uid: String(m.uid), folder: 'INBOX' },
          });
        }
      } catch (e) {
        // Falhou: aumenta o streak e agenda backoff exponencial (2,4,8,... até MAX).
        const streak = (failStreak.get(a.id) || 0) + 1;
        failStreak.set(a.id, streak);
        skipCycles.set(a.id, Math.min(MAX_BACKOFF, 2 ** Math.min(streak, 4)));
        console.warn(`[poller] conta ${a.email} falhou (${e.message}) — pausando ${skipCycles.get(a.id)} ciclos.`);
      }
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
  console.log(`[poller] iniciado (checando a cada ${INTERVAL_MS / 1000}s, com backoff).`);
  setInterval(tick, INTERVAL_MS);
}

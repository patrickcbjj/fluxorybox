import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { accessTokenFor } from './oauth.js';

// Abre uma conexão IMAP CRUA para a conta (senha OU token OAuth). Usada pelo pool
// e pelo teste de credenciais.
async function connect(account) {
  const auth = account.authType === 'oauth'
    ? { user: account.email, accessToken: await accessTokenFor(account) }
    : { user: account.email, pass: account.password };
  const client = new ImapFlow({
    host: account.imap.host,
    port: account.imap.port,
    secure: account.imap.secure,
    auth,
    logger: false,
    // Alguns servidores (Outlook) exigem TLS mais tolerante.
    tls: { rejectUnauthorized: false },
  });
  // ImapFlow é um EventEmitter: um evento 'error' sem listener DERRUBA o processo.
  // Com o listener, o erro só rejeita a operação em curso (tratada nos try/catch).
  client.on('error', () => {});
  await client.connect();
  return client;
}

// ---------------- Pool de conexões ----------------
// Mantém 1 conexão IMAP MORNA por conta e a reusa entre requests, em vez de fazer
// login+TLS+logout a cada chamada (economiza 1-3s por request E reduz logins, o que
// AJUDA contra o "abuse mode" da Microsoft/Google — menos autenticação, não mais).
// Conexões ociosas são fechadas após POOL_TTL.
const pool = new Map();     // accountId -> { client, lastUsed }
const pending = new Map();  // accountId -> Promise<client> (evita corrida ao criar)
const POOL_TTL = 5 * 60 * 1000; // 5 min ocioso → fecha

async function acquire(account) {
  const existing = pool.get(account.id);
  if (existing && existing.client.usable) {
    existing.lastUsed = Date.now();
    return existing.client;
  }
  if (pending.has(account.id)) return pending.get(account.id);

  const p = (async () => {
    const client = await connect(account);
    // Se a conexão cair, remove do pool pra próxima chamada reconectar do zero.
    const evict = () => {
      const e = pool.get(account.id);
      if (e && e.client === client) pool.delete(account.id);
    };
    client.on('close', evict);
    client.on('error', evict);
    pool.set(account.id, { client, lastUsed: Date.now() });
    return client;
  })();
  pending.set(account.id, p);
  try { return await p; } finally { pending.delete(account.id); }
}

// Executa uma operação com o cliente do pool (SEM logout — a conexão fica morna).
// Em erro, descarta a conexão do pool (pode estar quebrada) e propaga.
async function withClient(account, fn) {
  const client = await acquire(account);
  try {
    return await fn(client);
  } catch (e) {
    const entry = pool.get(account.id);
    if (entry && entry.client === client) pool.delete(account.id);
    try { client.close(); } catch (_) {}
    throw e;
  }
}

// Fecha conexões ociosas periodicamente.
setInterval(() => {
  const now = Date.now();
  for (const [id, e] of pool) {
    if (now - e.lastUsed > POOL_TTL) {
      pool.delete(id);
      e.client.logout().catch(() => {});
    }
  }
}, 60 * 1000).unref?.();

// Fecha a conexão de uma conta (usar ao remover/reconectar a conta).
export async function dropConnection(accountId) {
  const e = pool.get(accountId);
  if (e) {
    pool.delete(accountId);
    try { await e.client.logout(); } catch (_) {}
  }
}

// Testa credenciais: conecta e desconecta (fora do pool).
export async function testAccount(account) {
  const client = await connect(account);
  await client.logout();
  return true;
}

// Lista as pastas (mailboxes) da conta.
export async function listFolders(account) {
  return withClient(account, async (client) => {
    const list = await client.list();
    return list.map((m) => ({
      path: m.path,
      name: m.name,
      specialUse: m.specialUse || null,
      subscribed: !!m.subscribed,
    }));
  });
}

// Lista mensagens (cabeçalhos) de uma pasta, das mais recentes p/ trás.
export async function listMessages(account, { folder = 'INBOX', limit = 25, offset = 0 } = {}) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const total = client.mailbox.exists;
      if (!total) return { total: 0, messages: [] };

      // Faixa dos "últimos" pela sequência: total..1, com paginação.
      const end = total - offset;
      const start = Math.max(1, end - limit + 1);
      if (end < 1) return { total, messages: [] };

      const messages = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        uid: true, envelope: true, flags: true, internalDate: true, size: true,
      })) {
        messages.push(formatEnvelope(msg, account, folder));
      }
      // Mais recentes primeiro.
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      return { total, messages };
    } finally {
      lock.release();
    }
  });
}

// Busca no servidor (IMAP SEARCH) por assunto/remetente/destinatário/corpo.
export async function searchMessages(account, { folder = 'INBOX', query, limit = 40 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { total: 0, messages: [] };
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      // OR entre os campos; o servidor faz o match (inclui corpo).
      const uids = await client.search(
        { or: [{ subject: q }, { from: q }, { to: q }, { body: q }] },
        { uid: true }
      );
      if (!uids || !uids.length) return { total: 0, messages: [] };
      // Pega os mais recentes (UIDs maiores) e limita.
      const pick = uids.slice(-limit);
      const messages = [];
      for await (const msg of client.fetch(pick, {
        uid: true, envelope: true, flags: true, internalDate: true, size: true,
      }, { uid: true })) {
        messages.push(formatEnvelope(msg, account, folder));
      }
      messages.sort((a, b) => new Date(b.date) - new Date(a.date));
      return { total: uids.length, messages };
    } finally {
      lock.release();
    }
  });
}

// Lê o corpo completo de uma mensagem por UID.
export async function getMessage(account, { folder = 'INBOX', uid }) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);
      // Marca como lida.
      await client.messageFlagsAdd({ uid }, ['\\Seen'], { uid: true });
      return {
        accountId: account.id,
        folder,
        uid,
        subject: parsed.subject || '(sem assunto)',
        from: parsed.from?.value || [],
        to: parsed.to?.value || [],
        cc: parsed.cc?.value || [],
        date: parsed.date || null,
        text: parsed.text || '',
        html: parsed.html || null,
        attachments: (parsed.attachments || []).map((a) => ({
          filename: a.filename, contentType: a.contentType, size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

// Baixa um anexo específico (por índice) de uma mensagem.
export async function getAttachment(account, { folder = 'INBOX', uid, index }) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      const { content } = await client.download(uid, undefined, { uid: true });
      const parsed = await simpleParser(content);
      const att = (parsed.attachments || [])[index];
      if (!att) return null;
      return { filename: att.filename || `anexo-${index}`, contentType: att.contentType || 'application/octet-stream', content: att.content };
    } finally {
      lock.release();
    }
  });
}

// Marca/desmarca flags (\\Seen, \\Flagged) e arquiva/deleta.
export async function setFlags(account, { folder = 'INBOX', uid, add = [], remove = [] }) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (add.length) await client.messageFlagsAdd({ uid }, add, { uid: true });
      if (remove.length) await client.messageFlagsRemove({ uid }, remove, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

// Move mensagem para outra pasta (arquivar/lixeira).
export async function moveMessage(account, { folder = 'INBOX', uid, target }) {
  return withClient(account, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove({ uid }, target, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  });
}

function formatEnvelope(msg, account, folder) {
  const env = msg.envelope || {};
  return {
    accountId: account.id,
    accountEmail: account.email,
    folder,
    uid: msg.uid,
    subject: env.subject || '(sem assunto)',
    from: (env.from || []).map((a) => ({ name: a.name || '', address: a.address || '' })),
    to: (env.to || []).map((a) => ({ name: a.name || '', address: a.address || '' })),
    date: env.date || msg.internalDate || null,
    seen: (msg.flags && (msg.flags.has ? msg.flags.has('\\Seen') : msg.flags.includes?.('\\Seen'))) || false,
    flagged: (msg.flags && (msg.flags.has ? msg.flags.has('\\Flagged') : msg.flags.includes?.('\\Flagged'))) || false,
    size: msg.size || 0,
  };
}

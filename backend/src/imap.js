import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { accessTokenFor } from './oauth.js';

// Abre uma conexão IMAP para a conta (com senha OU token OAuth já disponíveis).
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
  await client.connect();
  return client;
}

// Testa credenciais: conecta e desconecta.
export async function testAccount(account) {
  const client = await connect(account);
  await client.logout();
  return true;
}

// Lista as pastas (mailboxes) da conta.
export async function listFolders(account) {
  const client = await connect(account);
  try {
    const list = await client.list();
    return list.map((m) => ({
      path: m.path,
      name: m.name,
      specialUse: m.specialUse || null,
      subscribed: !!m.subscribed,
    }));
  } finally {
    await client.logout();
  }
}

// Lista mensagens (cabeçalhos) de uma pasta, das mais recentes p/ trás.
export async function listMessages(account, { folder = 'INBOX', limit = 25, offset = 0 } = {}) {
  const client = await connect(account);
  try {
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
  } finally {
    await client.logout();
  }
}

// Busca no servidor (IMAP SEARCH) por assunto/remetente/destinatário/corpo.
export async function searchMessages(account, { folder = 'INBOX', query, limit = 40 } = {}) {
  const q = String(query || '').trim();
  if (!q) return { total: 0, messages: [] };
  const client = await connect(account);
  try {
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
  } finally {
    await client.logout();
  }
}

// Lê o corpo completo de uma mensagem por UID.
export async function getMessage(account, { folder = 'INBOX', uid }) {
  const client = await connect(account);
  try {
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
  } finally {
    await client.logout();
  }
}

// Baixa um anexo específico (por índice) de uma mensagem.
export async function getAttachment(account, { folder = 'INBOX', uid, index }) {
  const client = await connect(account);
  try {
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
  } finally {
    await client.logout();
  }
}

// Marca/desmarca flags (\\Seen, \\Flagged) e arquiva/deleta.
export async function setFlags(account, { folder = 'INBOX', uid, add = [], remove = [] }) {
  const client = await connect(account);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      if (add.length) await client.messageFlagsAdd({ uid }, add, { uid: true });
      if (remove.length) await client.messageFlagsRemove({ uid }, remove, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

// Move mensagem para outra pasta (arquivar/lixeira).
export async function moveMessage(account, { folder = 'INBOX', uid, target }) {
  const client = await connect(account);
  try {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageMove({ uid }, target, { uid: true });
      return true;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
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

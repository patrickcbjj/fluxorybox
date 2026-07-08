import { listAccounts, getAccount, addPushToken, removePushToken } from '../db.js';
import { listMessages, getMessage, setFlags, moveMessage, listFolders, getAttachment, searchMessages, resolveFolderPath } from '../imap.js';
import { sendMail } from '../smtp.js';
import { config } from '../config.js';
import { classifyError } from '../errors.js';
import { markHealthy, markUnhealthy } from '../health.js';
import { kickIdle } from '../idle.js';

export default async function messagesRoutes(app) {
  // Registra/remove o token FCM deste dispositivo (push de email novo).
  app.post('/api/push/register', async (req, reply) => {
    const { token } = req.body || {};
    if (!token) return reply.code(400).send({ error: 'token é obrigatório' });
    addPushToken(token);
    kickIdle(); // primeiro device registrado → liga o IDLE agora
    return { ok: true };
  });
  app.post('/api/push/unregister', async (req, reply) => {
    const { token } = req.body || {};
    if (token) removePushToken(token);
    return { ok: true };
  });

  // Caixa unificada: junta uma pasta (INBOX por padrão, ou special-use como \\Sent) de
  // todas as contas, ordenada por data. `folder` aceita 'INBOX' ou special-use ('\\Sent' etc.).
  app.get('/api/inbox', async (req, reply) => {
    const limit = Number(req.query.limit) || config.defaultLimit;
    const wantFolder = req.query.folder || 'INBOX';
    const accounts = listAccounts();
    const results = await Promise.allSettled(
      accounts.map(async (a) => {
        const full = getAccount(a.id, { withSecret: true });
        // Cada conta tem seu próprio caminho pra Enviados/Rascunhos/etc. — resolve por special-use.
        const path = await resolveFolderPath(full, wantFolder);
        return listMessages(full, { folder: path, limit });
      })
    );
    const messages = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        markHealthy(accounts[i].id);
        messages.push(...r.value.messages);
      } else {
        markUnhealthy(accounts[i].id, r.reason);
        const c = classifyError(r.reason);
        errors.push({ accountId: accounts[i].id, email: accounts[i].email, ...c });
      }
    });
    messages.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { count: messages.length, messages: messages.slice(0, limit * accounts.length), errors };
  });

  // Busca unificada no servidor: SEARCH na INBOX de todas as contas.
  app.get('/api/search', async (req, reply) => {
    const q = (req.query.q || '').trim();
    if (!q) return { count: 0, messages: [], errors: [] };
    const limit = Number(req.query.limit) || config.defaultLimit;
    const accounts = listAccounts();
    const results = await Promise.allSettled(
      accounts.map((a) => {
        const full = getAccount(a.id, { withSecret: true });
        return searchMessages(full, { folder: 'INBOX', query: q, limit });
      })
    );
    const messages = [];
    const errors = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') messages.push(...r.value.messages);
      else errors.push({ accountId: accounts[i].id, email: accounts[i].email, error: r.reason?.message });
    });
    messages.sort((a, b) => new Date(b.date) - new Date(a.date));
    return { count: messages.length, messages: messages.slice(0, limit * Math.max(accounts.length, 1)), errors };
  });

  // Busca no servidor numa conta+pasta.
  app.get('/api/accounts/:id/search', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    const q = (req.query.q || '').trim();
    const limit = Number(req.query.limit) || 40;
    return searchMessages(account, { folder, query: q, limit });
  });

  // Pastas de uma conta.
  app.get('/api/accounts/:id/folders', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    try {
      const folders = await listFolders(account);
      markHealthy(account.id);
      return folders;
    } catch (e) {
      markUnhealthy(account.id, e);
      const c = classifyError(e);
      return reply.code(502).send({ error: c.message, code: c.code, needsReconnect: c.needsReconnect });
    }
  });

  // Mensagens de uma pasta de uma conta.
  app.get('/api/accounts/:id/messages', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    const limit = Number(req.query.limit) || config.defaultLimit;
    const offset = Number(req.query.offset) || 0;
    try {
      const data = await listMessages(account, { folder, limit, offset });
      markHealthy(account.id);
      return data;
    } catch (e) {
      markUnhealthy(account.id, e);
      const c = classifyError(e);
      return reply.code(502).send({ error: c.message, code: c.code, needsReconnect: c.needsReconnect });
    }
  });

  // Lê uma mensagem específica (corpo completo).
  app.get('/api/accounts/:id/messages/:uid', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    try {
      const data = await getMessage(account, { folder, uid: Number(req.params.uid) });
      markHealthy(account.id);
      return data;
    } catch (e) {
      markUnhealthy(account.id, e);
      const c = classifyError(e);
      return reply.code(502).send({ error: c.message, code: c.code, needsReconnect: c.needsReconnect });
    }
  });

  // Baixa um anexo (por índice).
  app.get('/api/accounts/:id/messages/:uid/attachment/:index', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    const att = await getAttachment(account, { folder, uid: Number(req.params.uid), index: Number(req.params.index) });
    if (!att) return reply.code(404).send({ error: 'anexo não encontrado' });
    reply.header('Content-Type', att.contentType);
    reply.header('Content-Disposition', `attachment; filename="${encodeURIComponent(att.filename)}"`);
    return reply.send(att.content);
  });

  // Marca lida/não lida/favorito.
  app.post('/api/accounts/:id/messages/:uid/flags', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    const { add = [], remove = [] } = req.body || {};
    await setFlags(account, { folder, uid: Number(req.params.uid), add, remove });
    return { ok: true };
  });

  // Move mensagem (arquivar/lixeira).
  app.post('/api/accounts/:id/messages/:uid/move', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const folder = req.query.folder || 'INBOX';
    const { target } = req.body || {};
    if (!target) return reply.code(400).send({ error: 'target (pasta destino) é obrigatório' });
    await moveMessage(account, { folder, uid: Number(req.params.uid), target });
    return { ok: true };
  });

  // Envia email por uma conta. Body: { to, cc, bcc, subject, text, html, replyTo }
  app.post('/api/accounts/:id/send', async (req, reply) => {
    const account = getAccount(Number(req.params.id), { withSecret: true });
    if (!account) return reply.code(404).send({ error: 'conta não encontrada' });
    const { to } = req.body || {};
    if (!to) return reply.code(400).send({ error: 'informe o destinatário (Para)' });
    try {
      const result = await sendMail(account, req.body);
      return result;
    } catch (e) {
      const c = classifyError(e);
      if (c.needsReconnect) markUnhealthy(account.id, e);
      return reply.code(502).send({ error: c.message, code: c.code, needsReconnect: c.needsReconnect });
    }
  });
}

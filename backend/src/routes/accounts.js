import { listAccounts, getAccount, upsertAccount, deleteAccount, setNotify } from '../db.js';
import { dropConnection } from '../imap.js';
import { kickIdle, stopWatcher } from '../idle.js';
import { listProviders, detectProvider } from '../providers.js';
import { testAccount } from '../imap.js';
import { verifySmtp } from '../smtp.js';
import { getHealth, clearHealth } from '../health.js';

export default async function accountsRoutes(app) {
  // Provedores suportados (p/ o frontend montar o form).
  app.get('/api/providers', async () => listProviders());

  // Lista contas (sem senha), anotando o estado de conexão (desconectada?).
  app.get('/api/accounts', async () => listAccounts().map((a) => {
    const h = getHealth(a.id);
    const down = h ? !h.ok : false;
    return {
      ...a,
      disconnected: down,
      statusCode: down ? h.code : null,
      statusMessage: down ? h.message : null,
      needsReconnect: down ? !!h.needsReconnect : false,
    };
  }));

  // Adiciona/atualiza conta. Body: { email, password, displayName?, imap?, smtp? }
  app.post('/api/accounts', async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email e password são obrigatórios' });
    }
    try {
      const account = upsertAccount(req.body);
      clearHealth(account.id); // conta (re)adicionada → zera status de desconectada
      kickIdle();              // começa a observar a conta nova em tempo real
      return account;
    } catch (e) {
      return reply.code(400).send({ error: e.message });
    }
  });

  // Testa credenciais (IMAP + SMTP) sem salvar. Body igual ao POST.
  app.post('/api/accounts/test', async (req, reply) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'email e password são obrigatórios' });
    }
    const detected = detectProvider(email);
    const account = {
      email,
      password,
      displayName: req.body.displayName || '',
      imap: req.body.imap || detected?.imap,
      smtp: req.body.smtp || detected?.smtp,
    };
    if (!account.imap || !account.smtp) {
      return reply.code(400).send({ error: 'Provedor não detectado; informe imap e smtp.' });
    }
    const result = { imap: false, smtp: false };
    try { await testAccount(account); result.imap = true; }
    catch (e) { result.imapError = e.message; }
    try { await verifySmtp(account); result.smtp = true; }
    catch (e) { result.smtpError = e.message; }
    return result;
  });

  // Liga/desliga a notificação (push) de uma conta.
  app.post('/api/accounts/:id/notify', async (req, reply) => {
    const id = Number(req.params.id);
    const notify = req.body?.notify !== false;
    const ok = setNotify(id, notify);
    if (!ok) return reply.code(404).send({ error: 'conta não encontrada' });
    return { ok: true, notify };
  });

  // Remove conta.
  app.delete('/api/accounts/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const ok = deleteAccount(id);
    if (!ok) return reply.code(404).send({ error: 'conta não encontrada' });
    clearHealth(id);
    stopWatcher(id);                    // para o IDLE da conta removida
    dropConnection(id).catch(() => {}); // fecha a conexão morna da conta removida
    return { ok: true };
  });

  // Helper interno exposto no app p/ outras rotas pegarem conta com senha.
  app.decorate('accountWithSecret', (id) => getAccount(Number(id), { withSecret: true }));
}

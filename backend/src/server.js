import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertConfig } from './config.js';
import { seedFromEnv } from './db.js';
import { verifySession, checkCredentials, signSession } from './auth.js';
import accountsRoutes from './routes/accounts.js';
import messagesRoutes from './routes/messages.js';
import oauthRoutes from './routes/oauth.js';
import { startPoller } from './poller.js';

assertConfig();
seedFromEnv();

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });

await app.register(cors, { origin: true });

// Autenticação por sessão (login usuário+senha → token assinado).
// Só protege /api/*; estáticos, /api/login e /api/oauth/* passam livres.
app.addHook('onRequest', async (req, reply) => {
  if (!config.appUser) return; // aberto em dev (sem login configurado)
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return;
  if (url === '/api/login') return;
  if (url.startsWith('/api/oauth/')) return;
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.headers['api-token'];
  if (!verifySession(token)) {
    return reply.code(401).send({ error: 'não autorizado' });
  }
});

app.get('/health', async () => ({ ok: true, service: 'mail-backend', time: new Date().toISOString() }));

// Login: valida usuário/senha e devolve o token de sessão.
app.post('/api/login', async (req, reply) => {
  const { username, password } = req.body || {};
  if (!checkCredentials(username, password)) {
    return reply.code(401).send({ error: 'usuário ou senha inválidos' });
  }
  return { token: signSession(username) };
});

await app.register(accountsRoutes);
await app.register(messagesRoutes);
await app.register(oauthRoutes);

// Web app estático (mesmo app serve a interface).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
await app.register(fastifyStatic, {
  root: path.join(__dirname, '..', 'public'),
  prefix: '/',
});

try {
  await app.listen({ port: config.port, host: config.host });
  console.log(`[mail-backend] rodando em http://${config.host}:${config.port}`);
  startPoller(); // push de novos emails (se FCM configurado)
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

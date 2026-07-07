// Configuração central lida do ambiente.
// Na Discloud o PORT é injetado automaticamente (TYPE=site); localmente cai em 3000.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mini-loader de .env (Node não carrega sozinho ao rodar `node arquivo`).
(function loadEnv() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const envPath = path.join(root, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

export const config = {
  // Discloud faz proxy p/ a porta 8080 (Caddy). Localmente pode sobrescrever com PORT.
  port: Number(process.env.PORT) || 8080,
  host: '0.0.0.0',

  // Chave mestra p/ criptografar as senhas de app das contas (AES-256-GCM).
  // Gere uma com:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  masterKey: process.env.MASTER_KEY || '',

  // Token simples de acesso à API. Se vazio, a API fica aberta (só p/ dev local).
  apiToken: process.env.API_TOKEN || '',

  // Login por usuário e senha do app (gera sessão assinada com a MASTER_KEY).
  appUser: process.env.APP_USER || '',
  appPass: process.env.APP_PASS || '',

  // Caminho do arquivo SQLite. Na Discloud o filesystem é zerado a cada deploy,
  // então as contas devem ser re-semeadas via SEED_ACCOUNTS (ver abaixo).
  dbPath: process.env.DB_PATH || './data/mail.db',

  // Contas semeadas via env (JSON). Sobrevivem a redeploys na Discloud.
  // Formato: [{ "email":"x@gmail.com", "password":"app-pass", "displayName":"X" }]
  // O provedor (imap/smtp host) é autodetectado pelo domínio.
  seedAccounts: process.env.SEED_ACCOUNTS || '',

  // Quantas mensagens buscar por conta na caixa unificada por padrão.
  defaultLimit: Number(process.env.DEFAULT_LIMIT) || 25,

  // Base pública p/ montar os redirect_uri do OAuth.
  oauthRedirectBase: (process.env.OAUTH_REDIRECT_BASE || 'https://fluxorybox.discloud.app').replace(/\/$/, ''),

  // Credenciais OAuth (registradas no Azure / Google Cloud).
  ms: {
    clientId: process.env.MS_CLIENT_ID || '',
    clientSecret: process.env.MS_CLIENT_SECRET || '',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  },
};

export function assertConfig() {
  if (!config.masterKey) {
    console.warn(
      '[config] MASTER_KEY não definida — usando chave derivada insegura. ' +
      'Defina MASTER_KEY em produção.'
    );
  }
}

import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { encrypt, decrypt } from './crypto.js';
import { detectProvider } from './providers.js';

// Garante a pasta do banco.
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new DatabaseSync(config.dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT NOT NULL UNIQUE,
    display_name TEXT,
    imap_host   TEXT NOT NULL,
    imap_port   INTEGER NOT NULL,
    imap_secure INTEGER NOT NULL,
    smtp_host   TEXT NOT NULL,
    smtp_port   INTEGER NOT NULL,
    smtp_secure INTEGER NOT NULL,
    password_enc TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Tokens FCM dos dispositivos (push de email novo).
db.exec(`
  CREATE TABLE IF NOT EXISTS push_tokens (
    token      TEXT PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migração: colunas p/ contas OAuth (login "Entrar com ...").
const cols = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
if (!cols.includes('auth_type')) db.exec("ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'password'");
if (!cols.includes('provider')) db.exec('ALTER TABLE accounts ADD COLUMN provider TEXT');
if (!cols.includes('refresh_token_enc')) db.exec('ALTER TABLE accounts ADD COLUMN refresh_token_enc TEXT');
if (!cols.includes('avatar_url')) db.exec('ALTER TABLE accounts ADD COLUMN avatar_url TEXT');

// ---- Serialização (esconde a senha; nunca sai da API) ----
function rowToAccount(row, { withSecret = false } = {}) {
  if (!row) return null;
  const acc = {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    authType: row.auth_type || 'password',
    provider: row.provider || null,
    avatarUrl: row.avatar_url || null,
    imap: { host: row.imap_host, port: row.imap_port, secure: !!row.imap_secure },
    smtp: { host: row.smtp_host, port: row.smtp_port, secure: !!row.smtp_secure },
    createdAt: row.created_at,
  };
  if (withSecret) {
    if (acc.authType === 'oauth') {
      acc.refreshToken = row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null;
    } else {
      acc.password = decrypt(row.password_enc);
    }
  }
  return acc;
}

export function listAccounts() {
  const rows = db.prepare('SELECT * FROM accounts ORDER BY id').all();
  return rows.map((r) => rowToAccount(r));
}

export function getAccount(id, opts) {
  const row = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id);
  return rowToAccount(row, opts);
}

export function getAccountByEmail(email, opts) {
  const row = db.prepare('SELECT * FROM accounts WHERE email = ?').get(email);
  return rowToAccount(row, opts);
}

// Cria/atualiza uma conta. `input`: { email, password, displayName, imap?, smtp? }
export function upsertAccount(input) {
  const detected = detectProvider(input.email);
  const imap = input.imap || detected?.imap;
  const smtp = input.smtp || detected?.smtp;
  if (!imap || !smtp) {
    throw new Error(
      `Provedor não detectado para "${input.email}". Informe imap {host,port,secure} e smtp {host,port,secure}.`
    );
  }
  const passwordEnc = encrypt(input.password);
  const existing = getAccountByEmail(input.email);

  if (existing) {
    db.prepare(`
      UPDATE accounts SET display_name=?, imap_host=?, imap_port=?, imap_secure=?,
        smtp_host=?, smtp_port=?, smtp_secure=?, password_enc=? WHERE email=?
    `).run(
      input.displayName ?? existing.displayName ?? '', imap.host, imap.port, imap.secure ? 1 : 0,
      smtp.host, smtp.port, smtp.secure ? 1 : 0, passwordEnc, input.email
    );
    return getAccountByEmail(input.email);
  }

  const info = db.prepare(`
    INSERT INTO accounts (email, display_name, imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure, password_enc)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.email, input.displayName ?? '', imap.host, imap.port, imap.secure ? 1 : 0,
    smtp.host, smtp.port, smtp.secure ? 1 : 0, passwordEnc
  );
  return getAccount(info.lastInsertRowid);
}

// Cria/atualiza uma conta OAuth. `input`: { email, displayName, provider, refreshToken, imap, smtp }
export function upsertOAuthAccount(input) {
  const refreshEnc = input.refreshToken ? encrypt(input.refreshToken) : '';
  const existing = getAccountByEmail(input.email);
  const { imap, smtp } = input;

  if (existing) {
    // Só sobrescreve o refresh token se veio um novo (Google nem sempre reenvia).
    db.prepare(`
      UPDATE accounts SET display_name=?, auth_type='oauth', provider=?, avatar_url=?,
        imap_host=?, imap_port=?, imap_secure=?, smtp_host=?, smtp_port=?, smtp_secure=?,
        refresh_token_enc=COALESCE(NULLIF(?, ''), refresh_token_enc) WHERE email=?
    `).run(
      input.displayName ?? existing.displayName ?? '', input.provider, input.avatarUrl ?? null,
      imap.host, imap.port, imap.secure ? 1 : 0, smtp.host, smtp.port, smtp.secure ? 1 : 0,
      refreshEnc, input.email
    );
    return getAccountByEmail(input.email);
  }

  const info = db.prepare(`
    INSERT INTO accounts (email, display_name, auth_type, provider, avatar_url,
      imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
      password_enc, refresh_token_enc)
    VALUES (?, ?, 'oauth', ?, ?, ?, ?, ?, ?, ?, ?, '', ?)
  `).run(
    input.email, input.displayName ?? '', input.provider, input.avatarUrl ?? null,
    imap.host, imap.port, imap.secure ? 1 : 0, smtp.host, smtp.port, smtp.secure ? 1 : 0,
    refreshEnc
  );
  return getAccount(info.lastInsertRowid);
}

export function deleteAccount(id) {
  const info = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  return info.changes > 0;
}

// Atualiza o refresh_token de uma conta OAuth (Microsoft/Google rotacionam o refresh
// token a cada renovação; se não guardar o novo, o antigo eventualmente morre e a conta
// "desconecta sozinha"). Grava por email.
export function updateRefreshToken(email, refreshToken) {
  if (!email || !refreshToken) return false;
  const info = db.prepare('UPDATE accounts SET refresh_token_enc=? WHERE email=?')
    .run(encrypt(refreshToken), email);
  return info.changes > 0;
}

// Semeia contas a partir de SEED_ACCOUNTS (JSON) — sobrevive a redeploys na Discloud.
export function seedFromEnv() {
  if (!config.seedAccounts) return 0;
  let list;
  try {
    list = JSON.parse(config.seedAccounts);
  } catch {
    console.warn('[db] SEED_ACCOUNTS não é JSON válido — ignorado.');
    return 0;
  }
  let n = 0;
  for (const item of list) {
    if (!item?.email || !item?.password) continue;
    try {
      upsertAccount(item);
      n++;
    } catch (e) {
      console.warn(`[db] seed falhou p/ ${item.email}: ${e.message}`);
    }
  }
  if (n) console.log(`[db] ${n} conta(s) semeada(s) via SEED_ACCOUNTS.`);
  return n;
}

// ---- Tokens de push (FCM) ----
export function addPushToken(token) {
  if (!token) return;
  db.prepare('INSERT OR IGNORE INTO push_tokens (token) VALUES (?)').run(token);
}
export function removePushToken(token) {
  db.prepare('DELETE FROM push_tokens WHERE token = ?').run(token);
}
export function listPushTokens() {
  return db.prepare('SELECT token FROM push_tokens').all().map((r) => r.token);
}

export default db;

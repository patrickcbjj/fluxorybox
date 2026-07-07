import crypto from 'node:crypto';
import { config } from './config.js';

// Deriva uma chave de 32 bytes a partir da MASTER_KEY (base64 ou texto).
function getKey() {
  if (config.masterKey) {
    const raw = Buffer.from(config.masterKey, 'base64');
    if (raw.length === 32) return raw;
    // Se não for base64 de 32 bytes, deriva via SHA-256.
    return crypto.createHash('sha256').update(config.masterKey).digest();
  }
  // Fallback inseguro (apenas dev). Estável entre reinícios do mesmo processo.
  return crypto.createHash('sha256').update('insecure-dev-key').digest();
}

// AES-256-GCM. Retorna string "iv:tag:ciphertext" em base64.
export function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

export function decrypt(payload) {
  const [ivB64, tagB64, dataB64] = String(payload).split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

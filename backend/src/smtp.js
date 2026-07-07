import nodemailer from 'nodemailer';
import { accessTokenFor } from './oauth.js';

// Monta o objeto de auth do nodemailer (senha OU OAuth2 XOAUTH2).
async function buildAuth(account) {
  if (account.authType === 'oauth') {
    return { type: 'OAuth2', user: account.email, accessToken: await accessTokenFor(account) };
  }
  return { user: account.email, pass: account.password };
}

// Converte os anexos recebidos do front (base64) p/ o formato do nodemailer.
// Cada item: { filename, contentType, data } onde data é base64 (com ou sem data-URL).
function buildAttachments(attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return undefined;
  return attachments.map((a) => {
    const raw = String(a.data || '');
    const b64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw; // tira "data:...;base64,"
    return {
      filename: a.filename || 'anexo',
      content: Buffer.from(b64, 'base64'),
      contentType: a.contentType || undefined,
    };
  });
}

// Envia um email pela conta.
export async function sendMail(account, { to, cc, bcc, subject, text, html, replyTo, attachments }) {
  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure, // true = 465 (TLS direto); false = 587 (STARTTLS)
    auth: await buildAuth(account),
    tls: { rejectUnauthorized: false },
  });

  const fromName = account.displayName || account.email;
  const info = await transporter.sendMail({
    from: `"${fromName}" <${account.email}>`,
    to, cc, bcc, subject,
    text: text || undefined,
    html: html || undefined,
    replyTo: replyTo || undefined,
    attachments: buildAttachments(attachments),
  });

  return { messageId: info.messageId, accepted: info.accepted, rejected: info.rejected };
}

export async function verifySmtp(account) {
  const transporter = nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: await buildAuth(account),
    tls: { rejectUnauthorized: false },
  });
  await transporter.verify();
  return true;
}

// Presets de IMAP/SMTP por provedor + autodetecção pelo domínio do email.

export const PROVIDERS = {
  gmail: {
    name: 'Gmail',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    domains: ['gmail.com', 'googlemail.com'],
    note: 'Requer Senha de App (Verificação em 2 etapas ativada).',
  },
  outlook: {
    name: 'Outlook / Hotmail',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    note: 'Requer Senha de App na conta Microsoft.',
  },
  yahoo: {
    name: 'Yahoo',
    imap: { host: 'imap.mail.yahoo.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.com', port: 465, secure: true },
    domains: ['yahoo.com', 'ymail.com'],
    note: 'Requer Senha de App.',
  },
};

// Retorna { imap, smtp } com base no email, ou null se não reconhecido.
export function detectProvider(email) {
  const domain = String(email).split('@')[1]?.toLowerCase();
  if (!domain) return null;
  for (const key of Object.keys(PROVIDERS)) {
    if (PROVIDERS[key].domains.includes(domain)) {
      return { key, ...PROVIDERS[key] };
    }
  }
  return null;
}

// Lista pública p/ o frontend montar telas de "adicionar conta".
export function listProviders() {
  return Object.entries(PROVIDERS).map(([key, p]) => ({
    key, name: p.name, domains: p.domains, note: p.note,
    imap: p.imap, smtp: p.smtp,
  }));
}

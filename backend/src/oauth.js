import { config } from './config.js';

// Configuração OAuth2 por provedor (login direto "Entrar com ...").
export const OAUTH = {
  microsoft: {
    name: 'Microsoft',
    authUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenUrl: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    // Escopos pedidos no consentimento (inclui Graph p/ a foto).
    scopes: [
      'openid', 'email', 'profile', 'offline_access',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
      'https://graph.microsoft.com/User.Read',
    ].join(' '),
    // Escopo usado ao trocar o code por token (um recurso só: Outlook).
    tokenScope: [
      'openid', 'email', 'profile', 'offline_access',
      'https://outlook.office.com/IMAP.AccessAsUser.All',
      'https://outlook.office.com/SMTP.Send',
    ].join(' '),
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
    extraAuthParams: {},
    creds: () => config.ms,
  },
  google: {
    name: 'Google',
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile', 'https://mail.google.com/'].join(' '),
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    // access_type=offline + prompt=consent p/ garantir refresh_token.
    extraAuthParams: { access_type: 'offline', prompt: 'consent' },
    creds: () => config.google,
  },
};

export function redirectUri(provider) {
  return `${config.oauthRedirectBase}/api/oauth/${provider}/callback`;
}

export function isConfigured(provider) {
  const p = OAUTH[provider];
  if (!p) return false;
  const c = p.creds();
  return !!(c.clientId && c.clientSecret);
}

// Monta a URL de autorização p/ redirecionar o usuário.
export function buildAuthUrl(provider, state) {
  const p = OAUTH[provider];
  const c = p.creds();
  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: redirectUri(provider),
    scope: p.scopes,
    state,
    ...p.extraAuthParams,
  });
  return `${p.authUrl}?${params.toString()}`;
}

// Troca o "code" por tokens (access + refresh).
export async function exchangeCode(provider, code) {
  const p = OAUTH[provider];
  const c = p.creds();
  const body = new URLSearchParams({
    client_id: c.clientId,
    client_secret: c.clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(provider),
  });
  if (p.tokenScope) body.set('scope', p.tokenScope);
  return tokenRequest(p.tokenUrl, body);
}

// Usa o refresh_token p/ obter um novo access_token (opcionalmente p/ outro escopo/recurso).
export async function refreshAccessToken(provider, refreshToken, scope) {
  const p = OAUTH[provider];
  const c = p.creds();
  const params = {
    client_id: c.clientId,
    client_secret: c.clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  };
  if (scope) params.scope = scope;
  return tokenRequest(p.tokenUrl, new URLSearchParams(params));
}

// Busca a foto de perfil no Google (userinfo) → URL (ou null).
export async function fetchGooglePhoto(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.picture || null;
  } catch {
    return null;
  }
}

// Busca a foto de perfil do usuário no Microsoft Graph → data URL (ou null).
export async function fetchMicrosoftPhoto(refreshToken) {
  try {
    const tok = await refreshAccessToken('microsoft', refreshToken, 'https://graph.microsoft.com/User.Read');
    if (!tok.access_token) return null;
    const res = await fetch('https://graph.microsoft.com/v1.0/me/photos/96x96/$value', {
      headers: { Authorization: 'Bearer ' + tok.access_token },
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || 'image/jpeg';
    return `data:${type};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function tokenRequest(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `token endpoint ${res.status}`);
  }
  return data; // { access_token, refresh_token?, expires_in, id_token? }
}

// Dado um account OAuth (com refreshToken decriptado), devolve um access_token válido.
export async function accessTokenFor(account) {
  if (!account.refreshToken) {
    throw new Error(`Conta OAuth ${account.email} sem refresh token — reautorize.`);
  }
  const data = await refreshAccessToken(account.provider, account.refreshToken);
  if (!data.access_token) throw new Error('Falha ao renovar access token.');
  return data.access_token;
}

// Extrai email/nome/foto do id_token (JWT) — sem verificar assinatura (confiamos no endpoint).
export function profileFromIdToken(idToken) {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8'));
    return {
      email: payload.email || payload.preferred_username || payload.upn || null,
      name: payload.name || null,
      picture: payload.picture || null, // Google traz; Microsoft normalmente não.
    };
  } catch {
    return { email: null, name: null, picture: null };
  }
}

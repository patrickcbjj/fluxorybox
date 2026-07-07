import crypto from 'node:crypto';
import { config } from '../config.js';
import { OAUTH, isConfigured, buildAuthUrl, exchangeCode, profileFromIdToken, fetchMicrosoftPhoto, fetchGooglePhoto } from '../oauth.js';
import { upsertOAuthAccount } from '../db.js';
import { verifySession } from '../auth.js';
import { clearHealth } from '../health.js';

// Guarda os "state" pendentes (protege contra CSRF e amarra provider). Expira em 10 min.
const states = new Map();
function newState(provider) {
  const s = crypto.randomBytes(16).toString('hex');
  states.set(s, { provider, at: Date.now() });
  // Limpeza preguiçosa.
  for (const [k, v] of states) if (Date.now() - v.at > 600000) states.delete(k);
  return s;
}

function page(title, msg) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0f1115;color:#e6e8ee;
  display:grid;place-items:center;height:100vh;margin:0;text-align:center}
  .c{background:#171a21;padding:32px;border-radius:14px;border:1px solid #272c37;max-width:340px}
  a{color:#4f7cff}</style></head>
  <body><div class="c"><h2>${title}</h2><p>${msg}</p>
  <p><a href="/">← Voltar ao FluxoryBox</a></p></div>
  <script>try{setTimeout(function(){window.close()},2500)}catch(e){}</script></body></html>`;
}

export default async function oauthRoutes(app) {
  // Quais provedores OAuth estão configurados (p/ o frontend mostrar os botões).
  app.get('/api/oauth/status', async () => ({
    microsoft: isConfigured('microsoft'),
    google: isConfigured('google'),
  }));

  // Início do fluxo: valida o token via query (navegação top-level não manda header).
  app.get('/api/oauth/:provider/start', async (req, reply) => {
    const { provider } = req.params;
    if (!OAUTH[provider]) return reply.code(404).send({ error: 'provedor inválido' });
    if (config.appUser && !verifySession(req.query.token)) {
      return reply.code(401).type('text/html').send(page('Não autorizado', 'Sessão inválida. Faça login novamente.'));
    }
    if (!isConfigured(provider)) {
      return reply.type('text/html').send(page('OAuth não configurado',
        `Faltam as credenciais do ${OAUTH[provider].name} no servidor (.env).`));
    }
    const state = newState(provider);
    return reply.redirect(buildAuthUrl(provider, state));
  });

  // Retorno do provedor: troca o code por tokens e salva a conta.
  app.get('/api/oauth/:provider/callback', async (req, reply) => {
    const { provider } = req.params;
    const { code, state, error, error_description } = req.query;
    if (error) return reply.type('text/html').send(page('Autorização negada', error_description || error));
    const entry = states.get(state);
    if (!entry || entry.provider !== provider) {
      return reply.type('text/html').send(page('Sessão expirada', 'Tente adicionar a conta novamente.'));
    }
    states.delete(state);
    try {
      const tokens = await exchangeCode(provider, code);
      const profile = profileFromIdToken(tokens.id_token || '');
      if (!profile.email) throw new Error('Não consegui identificar o email da conta.');
      const p = OAUTH[provider];
      // Foto: Google vem no id_token; Microsoft busca no Graph.
      let avatarUrl = profile.picture || null;
      if (!avatarUrl && provider === 'google' && tokens.access_token) {
        avatarUrl = await fetchGooglePhoto(tokens.access_token);
      }
      if (!avatarUrl && provider === 'microsoft' && tokens.refresh_token) {
        avatarUrl = await fetchMicrosoftPhoto(tokens.refresh_token);
      }
      const saved = upsertOAuthAccount({
        email: profile.email,
        displayName: profile.name || profile.email,
        provider,
        refreshToken: tokens.refresh_token || '',
        avatarUrl,
        imap: p.imap,
        smtp: p.smtp,
      });
      if (saved?.id != null) clearHealth(saved.id); // reconectou → zera status
      const email = profile.email;
      return reply.type('text/html').send(page('Conta adicionada! ✅',
        `${email} conectada via ${p.name}. Você já pode fechar esta janela.`));
    } catch (e) {
      return reply.type('text/html').send(page('Falha ao conectar', e.message));
    }
  });
}

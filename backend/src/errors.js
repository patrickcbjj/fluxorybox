// Traduz erros técnicos (IMAP/SMTP/OAuth) em mensagens que o usuário entende,
// e diz se a conta precisa ser reconectada (login recusado/expirado/bloqueado).
export function classifyError(err) {
  const raw = (err && (err.message || String(err))) || '';
  const s = raw.toLowerCase();

  // Rede / servidor fora do ar — NÃO é problema da conta, é temporário.
  if (/timeout|etimedout|econnrefused|econnreset|econnaborted|enotfound|ehostunreach|enetunreach|getaddrinfo|socket|dns/.test(s)) {
    return {
      code: 'NETWORK',
      needsReconnect: false,
      message: 'Não foi possível conectar ao servidor de email agora. Verifique a conexão e tente de novo.',
    };
  }

  // Microsoft/Outlook: o token é válido (XOAUTH2 aceito) mas o IMAP recusa a caixa —
  // "User is authenticated but not connected". Quase sempre IMAP desativado na conta ou
  // bloqueio temporário de segurança do provedor. Reconectar não resolve (o login já é ok).
  if (/authenticated but not connected|imap.*(disabled|not enabled)|not connected/.test(s)) {
    return {
      code: 'IMAP_UNAVAILABLE',
      needsReconnect: false,
      message: 'O login funcionou, mas o provedor recusou o acesso IMAP desta conta. Verifique se o IMAP está ativado nas configurações do Outlook.com (Configurações → Email → Sincronizar email → POP e IMAP). Se você acabou de reconectar essa conta, pode ser um bloqueio temporário de segurança da Microsoft — aguarde alguns minutos e tente de novo.',
    };
  }

  // Autenticação recusada/expirada, token revogado ou conta bloqueada por abuso →
  // a conta caiu e precisa ser reconectada. (NÃO incluir erros genéricos tipo "command
  // failed" ou "NO"/"BAD" avulsos — são transitórios e não significam conta desconectada.)
  if (/aadsts|abuse|invalid credentials|authenticationfailed|authentication failed|invalid login|invalid_grant|interaction_required|username and password not accepted|login failed|auth(entication)?\s*(failed|denied|error)|application-specific password|app password|not authenticated|unauthorized|\b535\b|\b534\b|token.*(expired|invalid|revoked)|expired.*token|reautorize|sem refresh token|access.?denied/.test(s)) {
    return {
      code: 'AUTH',
      needsReconnect: true,
      message: 'Esta conta foi desconectada (login recusado ou expirado). Reconecte-a para voltar a receber os emails.',
    };
  }

  // Fallback genérico e amigável.
  return {
    code: 'UNKNOWN',
    needsReconnect: false,
    message: 'Não foi possível carregar suas mensagens. Tente novamente em instantes.',
  };
}

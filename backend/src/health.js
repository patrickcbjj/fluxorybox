// Saúde de conexão por conta (em memória). Atualizada sempre que uma operação IMAP
// tem sucesso (markHealthy) ou falha (markUnhealthy). A UI usa isso pra avisar que a
// conta caiu e oferecer "reconectar". Some no restart (é só um cache de estado).
import { classifyError } from './errors.js';

const map = new Map(); // accountId -> { ok, code, message, needsReconnect, at }

export function markHealthy(id) {
  map.set(id, { ok: true, at: Date.now() });
}

export function markUnhealthy(id, err) {
  const c = classifyError(err);
  map.set(id, { ok: false, at: Date.now(), ...c });
}

export function getHealth(id) {
  return map.get(id) || null;
}

// Chamar ao adicionar/reconectar/remover conta — zera o estado anterior.
export function clearHealth(id) {
  map.delete(id);
}

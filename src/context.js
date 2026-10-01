import { AsyncLocalStorage } from 'node:async_hooks';

// Contexto por ejecución: captura la salida (en vez de escribir directo a stdout)
// para que el mismo código sirva en modo directo, daemon y `batch`.
export const als = new AsyncLocalStorage();

export function newStore(extra = {}) {
  return { out: [], err: [], results: [], exitCode: 0, t0: Date.now(), connectMs: undefined, ...extra };
}

export const store = () => als.getStore() || null;

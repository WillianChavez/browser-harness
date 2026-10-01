/** Helpers de salida: JSON estructurado para el agente, texto legible para humanos. */
import { store } from './context.js';

function write(stream, text) {
  const s = store();
  if (s) (stream === 'err' ? s.err : s.out).push(text);
  else (stream === 'err' ? process.stderr : process.stdout).write(text);
}

function withTiming(flags, data) {
  const s = store();
  if (flags.time && s) return { ...data, ms: Date.now() - s.t0, connectMs: s.connectMs };
  return data;
}

export function emit(flags, data, textFn) {
  data = withTiming(flags, data);
  const s = store();
  if (s) s.results.push({ ok: true, ...data });
  if (flags.json) {
    write('out', JSON.stringify({ ok: true, ...data }, null, flags.compact ? 0 : 2) + '\n');
  } else if (textFn) {
    const t = textFn(data);
    if (t != null) write('out', t + '\n');
  } else {
    write('out', JSON.stringify(data, null, 2) + '\n');
  }
}

// Quita códigos de color ANSI de los mensajes de error (Playwright los incluye).
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

// Ruido del "call log" de Playwright (reintentos, esperas): no aporta y cuesta tokens.
const NOISE = /^(waiting \d+ms|retrying .* action|\d+\s*×\s*(waiting|retrying)|waiting for element to be visible, enabled and stable|element is visible, enabled and stable|scrolling into view if needed|done scrolling|attempting .* action|element is not stable)/i;

export function condense(msg) {
  const seen = new Set();
  const keep = [];
  for (const raw of String(msg).split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    if (NOISE.test(t.replace(/^-\s*/, ''))) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    keep.push(raw.length > 300 ? raw.slice(0, 300) + '…' : raw);
  }
  const out = keep.join('\n');
  return out.length > 900 ? out.slice(0, 900) + '…' : out;
}

export function fail(flags, message, extra = {}) {
  message = condense(String(message).replace(ANSI, '').trim());
  const res = { ok: false, error: message, ...extra };
  const s = store();
  if (s) {
    s.results.push(res);
    s.exitCode = 1;
  } else {
    process.exitCode = 1;
  }
  if (flags.json) write('out', JSON.stringify(res, null, flags.compact ? 0 : 2) + '\n');
  else write('err', `error: ${message}\n`);
}

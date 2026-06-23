/** Helpers de salida: JSON estructurado para el agente, texto legible para humanos. */

export function emit(flags, data, textFn) {
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: true, ...data }, null, 2) + '\n');
  } else if (textFn) {
    const t = textFn(data);
    if (t != null) process.stdout.write(t + '\n');
  } else {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  }
}

// Quita códigos de color ANSI de los mensajes de error (Playwright los incluye).
// eslint-disable-next-line no-control-regex
const ANSI = /\[[0-9;]*m/g;

export function fail(flags, message, extra = {}) {
  message = String(message).replace(ANSI, '').trim();
  if (flags.json) {
    process.stdout.write(JSON.stringify({ ok: false, error: message, ...extra }, null, 2) + '\n');
  } else {
    process.stderr.write(`error: ${message}\n`);
  }
  process.exitCode = 1;
}

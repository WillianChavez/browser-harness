import { execute } from './exec.js';

/** Modo directo (sin daemon): ejecuta en este proceso y vuelca la salida capturada. */
export async function run(argv) {
  const s = await execute(argv);
  if (s.out.length) process.stdout.write(s.out.join(''));
  if (s.err.length) process.stderr.write(s.err.join(''));
  // Soltar la conexión CDP sin cerrar Chrome (attach). Forzar salida.
  process.exit(s.exitCode || 0);
}

import { readFileSync } from 'node:fs';
import { emit, fail } from '../output.js';
import { store } from '../context.js';
import { splitArgs } from '../pageutil.js';
import { execute } from '../exec.js';

/**
 * bh batch '<json>' [--keep-going] — varios comandos bh en UNA llamada (una conexión,
 * un turno). JSON: [["fill","@e2","a@b.c"],["click","@e5"],["wait","text=Listo"],["text"]]
 * (cada paso: array de argv o string con comillas). Para evitar problemas de comillas
 * en el shell, pásalo por stdin: bh batch - <<'EOF' ... EOF
 * Cada paso pasa por la capa de permisos por separado; --allow/--tab/--timeout del batch
 * se heredan. Se detiene en el primer fallo salvo --keep-going.
 */
export async function run(args, flags) {
  let raw = args.join(' ').trim();
  if (!raw || raw === '-') raw = store()?.stdin ?? readFileSync(0, 'utf8');
  let steps;
  try {
    steps = JSON.parse(raw);
  } catch {
    return fail(flags, 'batch espera JSON: [["click","@e1"],["fill","@e2","texto"]] (o "-" para leerlo de stdin)');
  }
  if (!Array.isArray(steps) || steps.length === 0) return fail(flags, 'batch: la lista de pasos está vacía');

  const results = [];
  let failedAt = null;
  for (let i = 0; i < steps.length; i++) {
    const step = (typeof steps[i] === 'string' ? splitArgs(steps[i]) : steps[i]).map(String);
    if (step[0] === 'batch') {
      results.push({ cmd: 'batch', ok: false, error: 'batch anidado no permitido' });
      failedAt = i;
      break;
    }
    const argv = [...step, '--json'];
    if (flags.allow) argv.push('--allow');
    if (flags.tab != null) argv.push('--tab', String(flags.tab));
    if (flags.timeout) argv.push('--timeout', String(flags.timeout));
    const sub = await execute(argv);
    const last = sub.results[sub.results.length - 1] || { ok: sub.exitCode === 0 };
    results.push({ cmd: step.slice(0, 2).join(' '), ...last });
    if (!last.ok && !flags['keep-going']) {
      failedAt = i;
      break;
    }
  }
  if (failedAt !== null) {
    const bad = results[results.length - 1];
    return fail({ ...flags, compact: true }, `paso ${failedAt + 1} (${bad.cmd}) falló: ${bad.error || 'error'}`, { steps: results, failedAt });
  }
  emit({ ...flags, compact: true }, { count: results.length, steps: results }, (d) => d.steps.map((r, i) => `${i + 1}. ${r.cmd}: ok`).join('\n'));
}

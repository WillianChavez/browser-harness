import { loadConfig } from './config.js';
import { fail } from './output.js';
import { checkPermission } from './permissions.js';
import { als, newStore } from './context.js';
import * as session from './commands/session.js';
import * as tabs from './commands/tabs.js';
import * as view from './commands/view.js';
import * as interact from './commands/interact.js';
import * as advanced from './commands/advanced.js';
import * as inspect from './commands/inspect.js';
import * as batch from './commands/batch.js';
import * as facebook from './commands/facebook.js';
import * as dataset from './commands/dataset.js';
import * as scanmod from './commands/scan.js';
import * as xmod from './commands/x.js';

export const REGISTRY = {
  'session start': session.start,
  'session status': session.status,
  'session stop': session.stop,
  tabs: tabs.tabs,
  open: tabs.open,
  navigate: tabs.navigate,
  focus: tabs.focus,
  close: tabs.close,
  snapshot: view.snapshot,
  screenshot: view.screenshot,
  pdf: view.pdf,
  text: inspect.text,
  els: inspect.els,
  wait: inspect.wait,
  batch: batch.run,
  click: interact.click,
  fill: interact.fill,
  type: interact.type,
  press: interact.press,
  hover: interact.hover,
  select: interact.select,
  upload: interact.upload,
  eval: advanced.evaluate,
  cookies: advanced.cookies,
  storage: advanced.storage,
  'fb comments': facebook.comments,
  'fb posts': facebook.posts,
  'fb expand': facebook.expand,
  'fb harvest': facebook.harvest,
  'fb grab': facebook.grab,
  'row add': dataset.add,
  'row count': dataset.count,
  'fb scan': scanmod.scan,
  'x tweets': xmod.tweets,
  'x search': xmod.search,
  'x pool': xmod.pool,
};

const BOOL_FLAGS = new Set(['json', 'full', 'all', 'reveal', 'allow', 'force', 'png', 'gone', 'time', 'keep-going', 'no-fallback', 'no-daemon', 'no-aria']);
const VALUE_FLAGS = new Set(['out', 'timeout', 'tab', 'data', 'pages', 'posts', 'max', 'max-posts', 'rounds', 'scroll', 'queries', 'min-comments', 'revisit-days', 'max-chars', 'expect', 'match', 'settle', 'quality']);

export function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      if (BOOL_FLAGS.has(name)) flags[name] = true;
      else if (VALUE_FLAGS.has(name)) flags[name] = argv[++i];
      else flags[name] = true; // bandera desconocida -> boolean
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

export function help() {
  return `bh — browser harness

Sesión:   bh session start|status|stop | bh daemon status|stop|restart
Tabs:     bh tabs | open <url> | navigate <url> | focus <id> | close
Ver:      bh text [sel] | els [scope] [--match t] | snapshot | screenshot [--full] [--png] | pdf
Interact: bh click <sel|@eN> | fill <sel> <val> | type <sel> <txt> | press <key> [sel] | hover <sel> | select <sel> <val...>
Esperar:  bh wait <sel|text=..|ms> [--gone]
Lote:     bh batch '[["fill","@e2","x"],["click","@e5"],["text"]]'  (o "-" y JSON por stdin)
Avanzado: bh eval "<js>" | cookies [set <json>] | storage [session]

Los selectores aceptan @eN (refs de "bh els"). Flags: --json --time --timeout <ms> --tab <index|targetId> --no-daemon`;
}

/**
 * Núcleo único: resuelve el comando, aplica permisos y ejecuta el handler con la salida
 * CAPTURADA en un store (la comparten modo directo, daemon y batch). Nunca llama a
 * process.exit. Devuelve el store { out, err, results, exitCode }.
 */
export async function execute(argv, ctx = {}) {
  const s = newStore(ctx.stdin !== undefined ? { stdin: ctx.stdin } : {});
  await als.run(s, async () => {
    if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
      s.out.push(help() + '\n');
      return;
    }
    // clave de 2 tokens primero ("session start"), luego 1 token
    let key = `${argv[0]} ${argv[1]}`;
    let rest = argv.slice(2);
    if (!REGISTRY[key]) {
      key = argv[0];
      rest = argv.slice(1);
    }
    const handler = REGISTRY[key];
    if (!handler) {
      const { flags } = parse(argv);
      return fail(flags, `comando desconocido: ${argv.join(' ')}\n\n${help()}`);
    }
    const { positional, flags } = parse(rest);

    // --timeout aplica sólo a esta ejecución (el daemon reutiliza el proceso)
    const defaults = loadConfig().defaults;
    const saved = { ...defaults };
    if (flags.timeout) {
      defaults.timeout = Number(flags.timeout);
      defaults.actionTimeout = Number(flags.timeout);
    }
    try {
      // Capa de permisos: bloquea acciones sensibles (write/publish/download/transaction)
      // salvo opt-in. Las lecturas pasan siempre.
      const perm = checkPermission(key, { positional, flags });
      if (!perm.allowed) return fail(flags, perm.reason, { blocked: true, actionClass: perm.cls, site: perm.site });
      await handler(positional, flags);
    } catch (e) {
      fail(flags, e.message);
    } finally {
      Object.assign(defaults, saved);
    }
  });
  return s;
}

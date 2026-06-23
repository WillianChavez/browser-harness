import { loadConfig } from './config.js';
import { fail } from './output.js';
import * as session from './commands/session.js';
import * as tabs from './commands/tabs.js';
import * as view from './commands/view.js';
import * as interact from './commands/interact.js';
import * as advanced from './commands/advanced.js';
import * as facebook from './commands/facebook.js';
import * as dataset from './commands/dataset.js';

const REGISTRY = {
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
  click: interact.click,
  fill: interact.fill,
  type: interact.type,
  press: interact.press,
  hover: interact.hover,
  select: interact.select,
  eval: advanced.evaluate,
  cookies: advanced.cookies,
  storage: advanced.storage,
  'fb comments': facebook.comments,
  'fb posts': facebook.posts,
  'fb expand': facebook.expand,
  'fb harvest': facebook.harvest,
  'row add': dataset.add,
  'row count': dataset.count,
};

const BOOL_FLAGS = new Set(['json', 'full']);
const VALUE_FLAGS = new Set(['out', 'timeout', 'tab', 'data', 'pages', 'max', 'max-posts', 'rounds']);

function parse(argv) {
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

function help() {
  return `bh — browser harness

Sesión:   bh session start|status|stop
Tabs:     bh tabs | open <url> | navigate <url> | focus <id> | close
Ver:      bh snapshot | screenshot [--full] [--out f] | pdf [--out f]
Interact: bh click <sel> | fill <sel> <val> | type <sel> <txt> | press <key> [sel] | hover <sel> | select <sel> <val...>
Avanzado: bh eval "<js>" | cookies [set <json>] | storage [session]

Flags globales: --json  --timeout <ms>  --tab <index|targetId>`;
}

export async function run(argv) {
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(help() + '\n');
    return;
  }

  // resuelve clave de 2 tokens primero, luego 1 token
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
  if (flags.timeout) loadConfig().defaults.timeout = Number(flags.timeout);

  try {
    await handler(positional, flags);
  } catch (e) {
    fail(flags, e.message);
  } finally {
    // Soltar la conexión CDP sin cerrar Chrome (attach). Forzar salida.
    process.exit(process.exitCode || 0);
  }
}

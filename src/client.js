/**
 * Cliente liviano de bh: NO importa Playwright. Envía el comando al daemon local
 * (que mantiene la conexión CDP viva) y vuelca su salida. Si el daemon no existe lo
 * lanza; si no se puede usar, cae al modo directo (cli.js). --no-daemon / BH_NO_DAEMON=1
 * fuerzan modo directo.
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { daemonPort, codeStamp, ROOT } from './config.js';

const DAEMON = resolve(dirname(fileURLToPath(import.meta.url)), 'daemon.js');
// Procesos largos (minutos): van en su propio proceso para no bloquear la cola del daemon.
const DIRECT_ONLY = new Set(['fb harvest', 'fb grab', 'x pool']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(method, path, body, timeoutMs) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(
      {
        host: '127.0.0.1', port: daemonPort(), method, path, agent: false,
        headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {},
      },
      (resp) => {
        const chunks = [];
        resp.on('data', (c) => chunks.push(c));
        resp.on('end', () => {
          try { res(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { rej(e); }
        });
      }
    );
    if (timeoutMs) r.setTimeout(timeoutMs, () => r.destroy(new Error('timeout')));
    r.on('error', rej);
    if (data) r.write(data);
    r.end();
  });
}

const ping = (ms = 400) => request('GET', '/ping', null, ms).catch(() => null);

async function ensureDaemon() {
  const stamp = codeStamp();
  let p = await ping(300);
  if (p && p.stamp !== stamp) {
    // el código cambió desde que arrancó el daemon: reiniciarlo para no ejecutar versión vieja
    await request('POST', '/stop', {}, 500).catch(() => {});
    for (let i = 0; i < 20 && (await ping(100)); i++) await sleep(25);
    p = null;
  }
  if (p) return true;
  spawn(process.execPath, [DAEMON], { detached: true, stdio: 'ignore', cwd: ROOT }).unref();
  for (let i = 0; i < 120; i++) {
    await sleep(25);
    p = await ping(150);
    if (p) return true;
  }
  return false;
}

function readStdin() {
  return new Promise((res) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
  });
}

async function daemonCmd(args) {
  const sub = args[0] || 'status';
  if (sub === 'stop' || sub === 'restart') {
    const was = await ping();
    if (was) await request('POST', '/stop', {}, 500).catch(() => {});
    if (sub === 'stop') {
      process.stdout.write(JSON.stringify({ ok: true, stopped: !!was }) + '\n');
      return;
    }
    for (let i = 0; i < 20 && (await ping(100)); i++) await sleep(25);
  }
  if (sub === 'start' || sub === 'restart') await ensureDaemon();
  const p = await ping();
  process.stdout.write(JSON.stringify({ ok: true, running: !!p, ...(p || {}) }) + '\n');
}

export async function main(argv) {
  if (argv[0] === 'daemon') return daemonCmd(argv.slice(1));
  const key2 = `${argv[0]} ${argv[1]}`;
  const direct =
    argv.length === 0 || argv[0] === '--help' || argv[0] === '-h' ||
    argv.includes('--no-daemon') || process.env.BH_NO_DAEMON || DIRECT_ONLY.has(key2);

  if (!direct && (await ensureDaemon())) {
    let stdin;
    if (argv[0] === 'batch' && (argv.length === 1 || argv.includes('-')) && !process.stdin.isTTY) stdin = await readStdin();
    try {
      const r = await request('POST', '/run', { argv, cwd: process.cwd(), ...(stdin !== undefined ? { stdin } : {}) }, 0);
      if (r.stdout) process.stdout.write(r.stdout);
      if (r.stderr) process.stderr.write(r.stderr);
      process.exit(r.exitCode || 0);
    } catch (e) {
      // El comando pudo haberse ejecutado ya: NO reintentar en modo directo (evita doble click/envío).
      process.stderr.write(`error: la conexión con el daemon se interrumpió durante el comando (no se reintentó): ${e.message}\n`);
      process.exit(1);
    }
  }
  const { run } = await import('./cli.js');
  await run(argv);
}

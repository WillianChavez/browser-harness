/**
 * Daemon local de bh: mantiene la conexión CDP (Playwright) viva entre comandos para
 * evitar ~1–3s de arranque + connectOverCDP por llamada. Escucha sólo en 127.0.0.1.
 * Ejecuta los comandos en serie (cola) con el mismo núcleo que el modo directo.
 */
import http from 'node:http';
import { appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, daemonPort, codeStamp, WORKSPACE } from './config.js';
import { execute } from './exec.js';

const stamp = codeStamp();
const startedAt = Date.now();
const idleMs = (Number(loadConfig().daemonIdleMinutes) || 30) * 60_000;
let lastUse = Date.now();
let queue = Promise.resolve();
let runs = 0;

function log(msg) {
  try {
    mkdirSync(WORKSPACE, { recursive: true });
    appendFileSync(resolve(WORKSPACE, '.daemon.log'), `${new Date().toISOString()} ${msg}\n`);
  } catch { /* sin log */ }
}

function readBody(req) {
  return new Promise((res, rej) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => res(Buffer.concat(chunks).toString('utf8')));
    req.on('error', rej);
  });
}

async function runJob({ argv, cwd, stdin }) {
  runs++;
  if (cwd) { try { process.chdir(cwd); } catch { /* cwd inexistente */ } }
  const s = await execute(argv, stdin !== undefined ? { stdin } : {});
  return { stdout: s.out.join(''), stderr: s.err.join(''), exitCode: s.exitCode || 0 };
}

const server = http.createServer(async (req, res) => {
  const json = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(obj));
  };
  try {
    if (req.method === 'GET' && req.url === '/ping') {
      return json(200, { ok: true, pid: process.pid, stamp, uptimeMs: Date.now() - startedAt, runs });
    }
    if (req.method === 'POST' && req.url === '/stop') {
      json(200, { ok: true });
      setTimeout(() => process.exit(0), 20);
      return;
    }
    if (req.method === 'POST' && req.url === '/run') {
      lastUse = Date.now();
      const body = JSON.parse(await readBody(req));
      const job = queue.then(() => runJob(body));
      queue = job.catch(() => {});
      let out;
      try {
        out = await job;
      } catch (e) {
        log(`run error: ${e.stack || e.message}`);
        out = { stdout: '', stderr: `error: ${e.message}\n`, exitCode: 1 };
      }
      lastUse = Date.now();
      return json(200, out);
    }
    json(404, { ok: false });
  } catch (e) {
    log(`http error: ${e.stack || e.message}`);
    json(500, { ok: false, error: e.message });
  }
});

server.on('error', (e) => {
  log(`listen error: ${e.message}`);
  process.exit(e.code === 'EADDRINUSE' ? 0 : 1); // otro daemon ya ocupa el puerto
});
server.listen(daemonPort(), '127.0.0.1', () => log(`daemon up pid=${process.pid} port=${daemonPort()} stamp=${stamp}`));

process.on('unhandledRejection', (e) => log(`unhandledRejection: ${e?.stack || e}`));
process.on('uncaughtException', (e) => log(`uncaughtException: ${e?.stack || e}`));

setInterval(() => {
  if (Date.now() - lastUse > idleMs) {
    log('idle timeout, saliendo');
    process.exit(0);
  }
}, 60_000).unref();

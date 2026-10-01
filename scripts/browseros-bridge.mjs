#!/usr/bin/env node
// Puente MCP stdio -> BrowserOS neo (http://127.0.0.1:9010/mcp). El servidor solo acepta loopback de
// Windows, así que desde WSL este archivo se relanza con node.exe (keep-alive, más rápido que curl.exe por mensaje).
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// 9010 = proxy de la app BrowserOS; 9210 = servidor MCP directo (queda vivo si la app se cierra).
const CANDIDATES = [...new Set([process.env.BROWSEROS_MCP_URL, 'http://127.0.0.1:9010/mcp', 'http://127.0.0.1:9210/mcp'].filter(Boolean))];

if (process.platform !== 'win32') {
  const self = execFileSync('wslpath', ['-w', fileURLToPath(import.meta.url)]).toString().trim();
  const child = spawn('node.exe', [self], { cwd: '/mnt/c', stdio: ['inherit', 'inherit', 'inherit'] });
  child.on('exit', (c) => process.exit(c ?? 0));
  child.on('error', (e) => { process.stderr.write(`browseros-bridge: ${e.message}\n`); process.exit(1); });
} else {
  let sid = null;
  let initMsg = null;
  let cur = 0;
  const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
  const log = (m) => process.stderr.write(`browseros-bridge: ${m}\n`);

  async function post(msg) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };
    if (sid) headers['mcp-session-id'] = sid;
    let lastErr;
    for (let k = 0; k < CANDIDATES.length; k++) {
      const i = (cur + k) % CANDIDATES.length;
      try {
        const res = await fetch(CANDIDATES[i], { method: 'POST', headers, body: JSON.stringify(msg) });
        cur = i;
        const newSid = res.headers.get('mcp-session-id');
        if (newSid) sid = newSid;
        const text = await res.text();
        return { status: res.status, type: res.headers.get('content-type') || '', text };
      } catch (e) {
        lastErr = e;
      }
    }
    throw new Error(`BrowserOS MCP no accesible (${CANDIDATES.join(', ')}): ${lastErr?.cause?.code || lastErr?.message}`);
  }

  function messages({ type, text }) {
    if (type.includes('text/event-stream')) {
      return text.split('\n').filter((l) => l.startsWith('data: {')).map((l) => JSON.parse(l.slice(6)));
    }
    return text.trim() ? [JSON.parse(text)] : [];
  }

  async function reinit() {
    sid = null;
    const r = await post(initMsg);
    if (r.status >= 400) throw new Error(`reinit HTTP ${r.status}`);
    await post({ jsonrpc: '2.0', method: 'notifications/initialized' });
  }

  async function forward(msg) {
    if (msg.method === 'initialize') initMsg = msg;
    let r = await post(msg);
    if ((r.status === 404 || r.status === 400) && sid !== null && msg.method !== 'initialize' && initMsg) {
      log(`sesión inválida (HTTP ${r.status}), reinicializando`);
      await reinit();
      r = await post(msg);
    }
    if (r.status >= 400) {
      if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `BrowserOS HTTP ${r.status}: ${r.text.slice(0, 200)}` } });
      return;
    }
    for (const m of messages(r)) out(m);
  }

  // initialize primero y en orden; el resto en paralelo una vez que hay sesión.
  let ready = Promise.resolve();
  createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return log('línea no JSON ignorada'); }
    const run = () => forward(msg).catch((e) => {
      log(e.message);
      if (msg.id !== undefined) out({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: `bridge: ${e.message}` } });
    });
    if (msg.method === 'initialize') ready = run();
    else ready.then(run);
  }).on('close', () => process.exit(0));
}

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const WORKSPACE = resolve(ROOT, 'workspace');
export const STATE_FILE = resolve(WORKSPACE, '.state.json');

const DEFAULTS = {
  cdpUrl: 'http://172.24.240.1:9223',
  chromePath: '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe',
  userDataDir: 'C:\\Users\\willi\\AppData\\Local\\Google\\Chrome\\User Data',
  remoteDebuggingAddress: '0.0.0.0',
  defaults: { timeout: 30000, actionTimeout: 6000, handshakeTimeout: 5000 },
  daemonPort: 19333,
  daemonIdleMinutes: 30,
};

let cached = null;

export function loadConfig() {
  if (cached) return cached;
  let fileCfg = {};
  try {
    fileCfg = JSON.parse(readFileSync(resolve(ROOT, 'config.json'), 'utf8'));
  } catch {
    // no config file -> use defaults
  }
  cached = {
    ...DEFAULTS,
    ...fileCfg,
    defaults: { ...DEFAULTS.defaults, ...(fileCfg.defaults || {}) },
  };
  return cached;
}

/** Puerto de depuración derivado del cdpUrl. */
export function cdpPort(cfg = loadConfig()) {
  try {
    return Number(new URL(cfg.cdpUrl).port) || 9223;
  } catch {
    return 9223;
  }
}

/** Puerto del daemon local (127.0.0.1). */
export const daemonPort = (cfg = loadConfig()) => Number(cfg.daemonPort) || 19333;

/**
 * Sello de versión del código (mtime máximo de src/ y config.json). Si cambia, el
 * cliente reinicia el daemon para que nunca ejecute código viejo.
 */
export function codeStamp() {
  let max = 0;
  const walk = (dir) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = resolve(dir, f.name);
      if (f.isDirectory()) walk(p);
      else if (f.name.endsWith('.js')) max = Math.max(max, statSync(p).mtimeMs);
    }
  };
  walk(resolve(ROOT, 'src'));
  try { max = Math.max(max, statSync(resolve(ROOT, 'config.json')).mtimeMs); } catch { /* sin config */ }
  return String(Math.round(max));
}

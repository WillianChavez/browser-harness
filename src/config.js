import { readFileSync } from 'node:fs';
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
  defaults: { timeout: 30000, handshakeTimeout: 5000 },
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

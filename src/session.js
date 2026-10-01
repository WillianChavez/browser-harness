import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, cdpPort, WORKSPACE, STATE_FILE } from './config.js';
import { store } from './context.js';

/** Comprueba si el endpoint CDP responde. */
export async function cdpReachable(cfg = loadConfig()) {
  const url = new URL('/json/version', cfg.cdpUrl).toString();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.defaults.handshakeTimeout);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

/** Lanza Chrome en Windows con depuración remota, apuntando al perfil real. */
export function launchChrome(cfg = loadConfig()) {
  const port = cdpPort(cfg);
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${cfg.userDataDir}`,
  ];
  const child = spawn(cfg.chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid, command: cfg.chromePath, args };
}

// Conexión reutilizable: en el daemon vive entre llamadas (evita ~1s de connectOverCDP
// por comando); en modo directo el proceso muere tras cada comando, así que no cambia nada.
let cached = null; // { browser, version }

/**
 * Conecta al navegador: attach si el CDP responde; si no, lanza y reintenta.
 * Devuelve { browser, launched }.
 */
export async function connect({ allowLaunch = true } = {}) {
  const t0 = Date.now();
  const done = (r) => {
    const s = store();
    if (s && s.connectMs === undefined) s.connectMs = Date.now() - t0;
    return r;
  };
  if (cached && cached.browser.isConnected()) return done({ browser: cached.browser, launched: false, version: cached.version });
  cached = null;

  const cfg = loadConfig();
  let launched = false;
  let info = await cdpReachable(cfg);
  if (!info && allowLaunch) {
    launchChrome(cfg);
    launched = true;
    for (let i = 0; i < 30 && !info; i++) {
      await sleep(1000);
      info = await cdpReachable(cfg);
    }
  }
  if (!info) {
    throw new Error(
      `CDP no accesible en ${cfg.cdpUrl}. Si Chrome ya está abierto sin depuración, ` +
        `ciérralo y reintenta (bh session start).`
    );
  }
  const browser = await chromium.connectOverCDP(cfg.cdpUrl, {
    timeout: cfg.defaults.handshakeTimeout,
  });
  cached = { browser, version: info };
  browser.on('disconnected', () => {
    if (cached && cached.browser === browser) cached = null;
  });
  return done({ browser, launched, version: info });
}

/** Todas las páginas (tabs tipo 'page') de todos los contextos. */
export function allPages(browser) {
  return browser.contexts().flatMap((c) => c.pages());
}

const targetIds = new WeakMap(); // Page -> targetId (cada newCDPSession cuesta ~100ms)
const cdpSessions = new WeakMap(); // Page -> CDPSession reutilizable

/** Sesión CDP cacheada de una página (screenshot, etc.). */
export async function cdpSessionOf(page) {
  let s = cdpSessions.get(page);
  if (!s) {
    s = await page.context().newCDPSession(page);
    cdpSessions.set(page, s);
    page.once('close', () => cdpSessions.delete(page));
  }
  return s;
}

/** targetId real (vía CDP) de una página de Playwright. */
export async function targetIdOf(page) {
  const hit = targetIds.get(page);
  if (hit) return hit;
  const s = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await s.send('Target.getTargetInfo');
    targetIds.set(page, targetInfo.targetId);
    return targetInfo.targetId;
  } finally {
    await s.detach().catch(() => {});
  }
}

/** Lista de tabs. Los targetIds se resuelven en paralelo; los títulos sólo si se piden. */
export async function listTabs(browser, { titles = true } = {}) {
  const pages = allPages(browser);
  return Promise.all(
    pages.map(async (page, index) => ({
      index,
      targetId: await targetIdOf(page).catch(() => null),
      title: titles ? await page.title().catch(() => '') : '',
      url: page.url(),
      page,
    }))
  );
}

// ---- estado (pestaña activa) ----

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function writeState(state) {
  if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function setActiveTarget(targetId) {
  writeState({ ...readState(), activeTargetId: targetId });
}

export function getActiveTarget() {
  return readState().activeTargetId || null;
}

export function clearActiveTarget(targetId) {
  const state = readState();
  if (!targetId || state.activeTargetId === targetId) {
    delete state.activeTargetId;
    writeState(state);
  }
}

/**
 * Resuelve la página activa.
 * Prioridad: flag --tab (índice o targetId) > estado guardado > última página.
 */
export async function resolveActivePage(browser, flags = {}) {
  const tabs = await listTabs(browser, { titles: false });
  if (tabs.length === 0) throw new Error('No hay tabs abiertas.');

  if (flags.tab != null) {
    const byIndex = tabs.find((t) => String(t.index) === String(flags.tab));
    const byId = tabs.find((t) => t.targetId && t.targetId.startsWith(String(flags.tab)));
    const hit = byIndex || byId;
    if (!hit) throw new Error(`No existe la tab '${flags.tab}'.`);
    return hit;
  }

  const active = getActiveTarget();
  if (active) {
    const hit = tabs.find((t) => t.targetId === active);
    if (hit) return hit;
  }
  return tabs[tabs.length - 1];
}

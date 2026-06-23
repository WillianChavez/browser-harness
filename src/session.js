import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig, cdpPort, WORKSPACE, STATE_FILE } from './config.js';

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
    `--remote-debugging-address=${cfg.remoteDebuggingAddress}`,
    `--user-data-dir=${cfg.userDataDir}`,
  ];
  const child = spawn(cfg.chromePath, args, { detached: true, stdio: 'ignore' });
  child.unref();
  return { pid: child.pid, command: cfg.chromePath, args };
}

/**
 * Conecta al navegador: attach si el CDP responde; si no, lanza y reintenta.
 * Devuelve { browser, launched }.
 */
export async function connect({ allowLaunch = true } = {}) {
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
  return { browser, launched, version: info };
}

/** Todas las páginas (tabs tipo 'page') de todos los contextos. */
export function allPages(browser) {
  return browser.contexts().flatMap((c) => c.pages());
}

/** targetId real (vía CDP) de una página de Playwright. */
export async function targetIdOf(page) {
  const s = await page.context().newCDPSession(page);
  try {
    const { targetInfo } = await s.send('Target.getTargetInfo');
    return targetInfo.targetId;
  } finally {
    await s.detach().catch(() => {});
  }
}

/** Lista de tabs con metadatos. */
export async function listTabs(browser) {
  const pages = allPages(browser);
  const tabs = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let targetId = null;
    try {
      targetId = await targetIdOf(page);
    } catch {
      // ignore
    }
    tabs.push({ index: i, targetId, title: await page.title().catch(() => ''), url: page.url(), page });
  }
  return tabs;
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
  const tabs = await listTabs(browser);
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

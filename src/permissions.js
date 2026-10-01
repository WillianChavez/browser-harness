import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKSPACE } from './config.js';

/**
 * Capa de permisos: clasifica cada comando por tipo de acción y decide si está
 * permitido según una política por-sitio. Motivo (revisión de seguridad): el
 * harness maneja el perfil PERSONAL del usuario vía CDP; una acción de escritura/
 * publicación/transacción sobre un sitio logueado puede tener efectos reales
 * (enviar, comprar, borrar). Antes no había ninguna distinción read/write.
 *
 * Defaults CONSERVADORES:
 *   - read        -> permitido en todo sitio.
 *   - download    -> sólo scraping de facebook/x (propósito de la herramienta).
 *   - write/publish/transaction -> DENEGADOS salvo opt-in (--allow o política).
 *
 * Opt-in:
 *   - bandera --allow (una vez, para esta invocación).
 *   - workspace/permissions.json: { "<clase>": "*" | ["dominio", ...] }.
 */

const POLICY_FILE = resolve(WORKSPACE, 'permissions.json');

// Comando (clave del REGISTRY de cli.js) -> clase de acción.
const ACTION_CLASS = {
  'session start': 'read', 'session status': 'read', 'session stop': 'read',
  tabs: 'read', open: 'read', navigate: 'read', focus: 'read', close: 'read',
  snapshot: 'read', screenshot: 'read', pdf: 'read',
  storage: 'read',
  text: 'read', els: 'read', wait: 'read',
  batch: 'read',       // cada paso se evalúa por separado (hereda --allow del batch).
  click: 'write', fill: 'write', type: 'write', press: 'write', hover: 'write', select: 'write', upload: 'write',
  eval: 'write',       // JS arbitrario: puede mutar/enviar -> escritura.
  cookies: 'read',     // listar es lectura; `cookies set` se re-clasifica abajo.
  'fb comments': 'read', 'fb posts': 'read', 'fb expand': 'read', 'fb scan': 'read',
  'fb harvest': 'download', 'fb grab': 'download',
  'x tweets': 'read', 'x search': 'read', 'x pool': 'download',
  'row add': 'read',   // escritura LOCAL del dataset, no acción sobre un sitio.
  'row count': 'read',
};

const DEFAULT_POLICY = {
  read: '*',
  download: ['facebook.com', 'x.com', 'twitter.com'],
  write: [],
  publish: [],
  transaction: [],
};

function loadPolicy() {
  const p = { ...DEFAULT_POLICY };
  if (existsSync(POLICY_FILE)) {
    try {
      const f = JSON.parse(readFileSync(POLICY_FILE, 'utf8'));
      for (const k of Object.keys(DEFAULT_POLICY)) if (k in f) p[k] = f[k];
    } catch { /* política inválida -> defaults */ }
  }
  return p;
}

/** Clase de acción efectiva del comando (re-clasifica `cookies set`). */
export function actionClass(commandKey, positional = []) {
  if (commandKey === 'cookies' && positional[0] === 'set') return 'write';
  return ACTION_CLASS[commandKey] || 'read';
}

/** Dominio base (registrable, aproximado) a partir de una URL o slug de página. */
function hostToSite(host) {
  const parts = String(host).toLowerCase().replace(/^www\./, '').split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : parts.join('.');
}

/**
 * Sitio objetivo, best-effort SIN abrir el navegador (barato). Sólo derivable para
 * comandos que llevan el destino en los argumentos (harvest/grab/pool/open/navigate).
 * Para write/eval sobre la pestaña activa el sitio queda null (se decide por clase).
 */
function deriveSite(commandKey, positional, flags) {
  const raw = flags.pages || flags.posts || flags.queries || positional[0] || '';
  const first = String(raw).split(',')[0].trim();
  if (commandKey.startsWith('x ')) return 'x.com';
  if (commandKey.startsWith('fb ')) return 'facebook.com';
  if (!first) return null;
  try {
    if (/^https?:\/\//.test(first)) return hostToSite(new URL(first).host);
    if (first.includes('.') && first.includes('/')) return hostToSite(new URL('https://' + first).host);
  } catch { /* no parseable */ }
  return null;
}

function siteAllowed(rule, site) {
  if (rule === '*') return true;
  if (!Array.isArray(rule)) return false;
  if (rule.includes('*')) return true;
  if (!site) return false;
  return rule.some((d) => site === d || site.endsWith('.' + d));
}

/**
 * Decide si el comando puede ejecutarse.
 * @returns {{allowed:boolean, cls:string, site:?string, reason:string}}
 */
export function checkPermission(commandKey, { positional = [], flags = {} } = {}) {
  const cls = actionClass(commandKey, positional);
  const site = deriveSite(commandKey, positional, flags);
  if (cls === 'read') return { allowed: true, cls, site, reason: 'lectura' };
  if (flags.allow) return { allowed: true, cls, site, reason: 'permitido por --allow' };
  const policy = loadPolicy();
  if (siteAllowed(policy[cls], site)) {
    return { allowed: true, cls, site, reason: `permitido por política (${cls})` };
  }
  return {
    allowed: false,
    cls,
    site,
    reason:
      `acción '${cls}'${site ? ` sobre ${site}` : ''} bloqueada por política. ` +
      `Permite una vez con --allow, o agrega a ${POLICY_FILE} ` +
      `{"${cls}": ${site ? `["${site}"]` : '"*"'}}.`,
  };
}

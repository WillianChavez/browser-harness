import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import { connect, resolveActivePage, setActiveTarget } from '../session.js';
import { loadConfig } from '../config.js';
import { emit, fail } from '../output.js';
import { pick, resolveSel, settle, arm, domCount, obstruction, jsClick } from '../pageutil.js';

const MIME_BY_EXT = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
};

async function active(flags) {
  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);
  if (tab.targetId) setActiveTarget(tab.targetId);
  return tab;
}

// Timeout de acción corto (falla rápido); --timeout lo sobrescribe.
const T = () => ({ timeout: loadConfig().defaults.actionTimeout ?? 6000 });

/** Línea del call log de Playwright que explica quién bloquea el click. */
function interceptor(msg) {
  const m = /(<[^\n]{0,160}>[^\n]{0,60}intercepts pointer events)/.exec(String(msg));
  return m ? m[1].replace(/\s+/g, ' ') : null;
}

export async function click(args, flags) {
  const sel = args[0];
  if (!sel) return fail(flags, 'falta selector: bh click <selector|@eN>');
  const tab = await active(flags);
  const loc = await pick(tab.page, sel);
  // Captura el cambio observado, no sólo "hice clic": URL antes/después, si navegó,
  // delta de nodos y nº de mutaciones del DOM. Con --expect <selector> confirma una post-condición.
  const urlBefore = tab.page.url();
  const domBefore = await arm(tab.page);
  let via = 'click';
  let warning = null;
  const canFallback = !flags.force && !flags['no-fallback'];
  if (canFallback) {
    const blocker = await obstruction(loc);
    if (blocker && (await jsClick(loc))) {
      via = 'js-fallback';
      warning = `tapado por ${blocker}; se usó el.click()`;
    }
  }
  if (via === 'click') {
    try {
      await loc.click({ timeout: Math.min(T().timeout, 3000), force: !!flags.force });
    } catch (e) {
      if (!canFallback || !(await jsClick(loc))) throw e;
      via = 'js-fallback';
      warning = interceptor(e.message) ? `bloqueado por: ${interceptor(e.message)}` : 'elemento no accionable; se usó el.click()';
    }
  }
  let expected = null;
  let domAfter;
  let mutations = null;
  if (flags.expect) {
    expected = await tab.page.waitForSelector(resolveSel(String(flags.expect)), { timeout: T().timeout })
      .then(() => true).catch(() => false);
    domAfter = await domCount(tab.page);
  } else {
    // espera adaptativa: DOM quieto durante --settle ms (def. 150), tope 900ms
    const r = await settle(tab.page, Number(flags.settle || 150));
    domAfter = r.count;
    mutations = r.mutations;
  }
  const urlAfter = tab.page.url();
  const navigated = urlBefore !== urlAfter;
  const domDelta = domBefore != null && domAfter != null ? domAfter - domBefore : null;
  const changed = navigated || (flags.expect ? expected : domDelta !== 0 || mutations > 0);
  emit(
    flags,
    { clicked: sel, via, ...(warning ? { warning } : {}), urlBefore, urlAfter, navigated, domDelta, ...(mutations != null ? { mutations } : {}), expect: flags.expect || null, expected, changed },
    (d) => `click: ${d.clicked}${d.via !== 'click' ? ` [${d.via}]` : ''}` +
      (d.navigated ? ` → navegó a ${d.urlAfter}` : '') +
      (d.expect != null ? ` | expect(${d.expect}): ${d.expected ? 'cumplido' : 'NO cumplido'}` : '') +
      (!d.navigated && d.expect == null ? ` | ΔDOM: ${d.domDelta == null ? '?' : d.domDelta}` : '') +
      (d.changed ? '' : ' | (sin cambio observable)') +
      (d.warning ? ` | ⚠ ${d.warning}` : '')
  );
}

export async function fill(args, flags) {
  const [sel, ...rest] = args;
  const value = rest.join(' ');
  if (!sel) return fail(flags, 'uso: bh fill <selector|@eN> <valor>');
  const tab = await active(flags);
  await (await pick(tab.page, sel)).fill(value, T());
  emit(flags, { filled: sel, value }, (d) => `fill: ${d.filled} = "${d.value}"`);
}

export async function type(args, flags) {
  const [sel, ...rest] = args;
  const text = rest.join(' ');
  if (!sel) return fail(flags, 'uso: bh type <selector|@eN> <texto>');
  const tab = await active(flags);
  await (await pick(tab.page, sel)).pressSequentially(text, T());
  emit(flags, { typed: sel, text }, (d) => `type: ${d.typed}`);
}

export async function press(args, flags) {
  const key = args[0];
  if (!key) return fail(flags, 'uso: bh press <Key> [selector|@eN]');
  const sel = args[1];
  const tab = await active(flags);
  if (sel) await (await pick(tab.page, sel)).press(key, T());
  else await tab.page.keyboard.press(key);
  emit(flags, { key, selector: sel || null }, (d) => `press: ${d.key}`);
}

export async function hover(args, flags) {
  const sel = args[0];
  if (!sel) return fail(flags, 'uso: bh hover <selector|@eN>');
  const tab = await active(flags);
  await (await pick(tab.page, sel)).hover(T());
  emit(flags, { hovered: sel }, (d) => `hover: ${d.hovered}`);
}

export async function upload(args, flags) {
  const [sel, path] = args;
  if (!sel || !path) return fail(flags, 'uso: bh upload <selector> <ruta-local-al-archivo>');
  const tab = await active(flags);
  const buffer = readFileSync(path);
  const name = basename(path);
  const mimeType = MIME_BY_EXT[extname(path).toLowerCase()] || 'application/octet-stream';
  await tab.page.setInputFiles(resolveSel(sel), { name, mimeType, buffer }, T());
  emit(flags, { uploaded: sel, file: name, bytes: buffer.length }, (d) => `upload: ${d.uploaded} <- ${d.file} (${d.bytes}B)`);
}

export async function select(args, flags) {
  const [sel, ...values] = args;
  if (!sel || values.length === 0) return fail(flags, 'uso: bh select <selector> <valor...>');
  const tab = await active(flags);
  const result = await (await pick(tab.page, sel)).selectOption(values, T());
  emit(flags, { selector: sel, selected: result }, (d) => `select: ${d.selected.join(', ')}`);
}

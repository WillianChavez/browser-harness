/** Utilidades de página compartidas: selectores robustos, refs @eN y espera de asentamiento. */

/** `@e3` (ref generado por `bh els`) -> selector CSS real. */
export function resolveSel(sel) {
  const m = /^@(e\d+|dialog)$/.exec(String(sel));
  return m ? `[data-bh-ref="${m[1]}"]` : sel;
}

/**
 * Localiza el elemento prefiriendo el primer coincidente VISIBLE (los selectores por
 * texto suelen resolver antes a nodos ocultos, p. ej. JSON embebido). Si no hay ninguno
 * falla en ~1.5s con una pista útil, en vez de esperar el timeout completo de acción.
 */
export async function pick(page, rawSel, { visible = true, wait = 1500 } = {}) {
  const sel = resolveSel(rawSel);
  const any = page.locator(sel);
  if (visible) {
    const vis = page.locator(`${sel} >> visible=true`);
    if ((await vis.count()) > 0) return vis.first();
  }
  if ((await any.count()) === 0) {
    try {
      await any.first().waitFor({ state: 'attached', timeout: wait });
    } catch {
      const hint = /^@(e\d+|dialog)$/.test(String(rawSel))
        ? 'el ref ya no existe (la página cambió): corre "bh els" de nuevo'
        : 'usa "bh els" para listar elementos o "bh wait" si aún está cargando';
      throw new Error(`sin coincidencias para "${rawSel}" (esperé ${wait}ms); ${hint}`);
    }
  }
  return any.first();
}

/**
 * Arma un observador de mutaciones ANTES de actuar (así se captura lo que el propio
 * click cambia de forma síncrona). Devuelve el nº de nodos actual.
 */
export function arm(page) {
  return page
    .evaluate(() => {
      try { window.__bhMo?.disconnect(); } catch { /* noop */ }
      window.__bhMut = 0;
      window.__bhLast = performance.now();
      window.__bhMo = new MutationObserver((m) => { window.__bhMut += m.length; window.__bhLast = performance.now(); });
      window.__bhMo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
      return document.querySelectorAll('*').length;
    })
    .catch(() => null);
}

/**
 * Espera a que el DOM se calme (sin mutaciones durante `quietMs`, tope `capMs`) y devuelve
 * { count, mutations }. Reemplaza el sleep fijo de 500ms tras cada click. Si la acción
 * navegó (el contexto se destruye) espera domcontentloaded.
 */
export async function settle(page, quietMs = 150, capMs = 900) {
  try {
    return await page.evaluate(
      ([q, c]) =>
        new Promise((res) => {
          const t0 = performance.now();
          const tick = () => {
            const quiet = performance.now() - (window.__bhLast ?? t0) >= q;
            if (quiet || performance.now() - t0 >= c) {
              const mutations = window.__bhMut ?? 0;
              try { window.__bhMo?.disconnect(); } catch { /* noop */ }
              res({ count: document.querySelectorAll('*').length, mutations });
            } else setTimeout(tick, 30);
          };
          setTimeout(tick, Math.min(q, 60));
        }),
      [quietMs, capMs]
    );
  } catch {
    await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
    const count = await page.evaluate(() => document.querySelectorAll('*').length).catch(() => null);
    return { count, mutations: 1 };
  }
}

/**
 * ¿Algo tapa el centro del elemento? Devuelve una descripción del tapador o null.
 * Detecta overlays al instante en lugar de esperar el timeout completo de Playwright.
 */
export async function obstruction(loc) {
  const probe = () =>
    loc.evaluate((el) => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!t || el === t || el.contains(t) || t.contains(el)) return null;
      const cls = typeof t.className === 'string' && t.className.trim() ? '.' + t.className.trim().split(/\s+/)[0] : '';
      return `<${t.tagName.toLowerCase()}${t.id ? '#' + t.id : ''}${cls}>`;
    }, null, { timeout: 1500 }).catch(() => null);
  const first = await probe();
  if (!first) return null;
  await new Promise((r) => setTimeout(r, 300)); // un overlay transitorio (spinner) suele irse solo
  return probe();
}

/** Click directo por JS (sobre el elemento, ignorando lo que lo tape). */
export const jsClick = (loc) =>
  loc.evaluate((el) => { el.scrollIntoView({ block: 'center' }); el.click(); return true; }, null, { timeout: 2000 }).catch(() => false);

export const domCount = (page) => page.evaluate(() => document.querySelectorAll('*').length).catch(() => null);

/** Parte un string en tokens respetando comillas simples/dobles. */
export function splitArgs(line) {
  const out = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\(["\\])/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

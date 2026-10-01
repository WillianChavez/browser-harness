import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect, resolveActivePage } from '../session.js';
import { WORKSPACE } from '../config.js';
import { emit, fail } from '../output.js';

const POOL = resolve(WORKSPACE, 'x_pool.jsonl');

function extractFn() {
  const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
  const seen = new Set();
  const out = [];
  for (const a of arts) {
    const textEl = a.querySelector('[data-testid="tweetText"]');
    const text = (textEl ? textEl.innerText : '').trim();
    if (!text) continue;
    const timeLink = a.querySelector('time')?.closest('a[href*="/status/"]');
    const permalink = timeLink ? new URL(timeLink.getAttribute('href'), location.origin).href.split('?')[0] : '';
    const userLinks = [...a.querySelectorAll('a[href^="/"]')].filter((x) =>
      /^\/[A-Za-z0-9_]+$/.test(x.getAttribute('href') || '')
    );
    const author = userLinks.length ? userLinks[0].getAttribute('href').slice(1) : '';
    const truncated = /…\s*$/.test(text) || !!a.querySelector('[data-testid="tweet-text-show-more-link"]');
    const key = author + '|' + text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ author, permalink, text: text.slice(0, 1500), truncated });
  }
  return out;
}

/**
 * Recolecta tuits extrayendo DESPUÉS DE CADA scroll y acumulando, no una sola vez
 * al final. X virtualiza el timeline: los tuits que salen del viewport se eliminan
 * del DOM, así que "scroll-todo-luego-extraer" pierde los intermedios. Dedup por
 * author|texto. Devuelve el arreglo acumulado en orden de aparición.
 */
async function collectWhileScrolling(page, scrolls) {
  const acc = new Map();
  const absorb = async () => {
    const items = await page.evaluate(extractFn).catch(() => []);
    for (const it of items) {
      const key = (it.author || '') + '|' + (it.text || '').slice(0, 80);
      if (!acc.has(key)) acc.set(key, it);
    }
  };
  await absorb(); // lo visible antes de scrollear
  for (let i = 0; i < scrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, 2000));
    await page.waitForTimeout(1200);
    await absorb();
  }
  return [...acc.values()];
}

/**
 * Extrae los tuits de la pestaña activa (timeline o resultados de búsqueda),
 * acumulando a lo largo del scroll. Autor (@handle), texto exacto y permalink real.
 */
export async function tweets(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);

  const scrolls = Number(flags.scroll || 0);
  const items = await collectWhileScrolling(tab.page, scrolls);
  const data = { url: tab.page.url(), count: items.length, items };

  emit(
    flags,
    data,
    (d) =>
      `${d.count} tuits en ${d.url}\n\n` +
      d.items.map((it, i) => `[${i}] @${it.author || '?'}\n${it.text}\n${it.permalink || '(sin link)'}`).join('\n\n---\n')
  );
}

/** Navega a una búsqueda de X (Últimos/Latest) para una consulta o hashtag. */
export async function search(args, flags) {
  const q = args.join(' ');
  if (!q) return fail(flags, 'uso: bh x search "<query o #hashtag>"');
  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);
  const url = `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
  await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await tab.page
    .waitForSelector('article[data-testid="tweet"], [data-testid="emptyState"]', { timeout: 15000 })
    .catch(() => {});
  emit(flags, { url: tab.page.url() }, (d) => `→ ${d.url}`);
}

/**
 * Recorre varias búsquedas (hashtags/queries) de X, extrae tuits (con scroll) y
 * los agrega -sin evaluar- a workspace/x_pool.jsonl, con dedup global.
 * uso: bh x pool --queries "#Pupusas,#CulturaSV,..." [--scroll 4]
 */
export async function pool(args, flags) {
  const queries = (flags.queries || args.join(',') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!queries.length) return fail(flags, 'uso: bh x pool --queries "#tag1,#tag2,..." [--scroll 4]');
  const scrolls = Number(flags.scroll || 4);

  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);

  const seen = new Set();
  if (existsSync(POOL)) {
    for (const line of readFileSync(POOL, 'utf8').split('\n').filter(Boolean)) {
      try {
        const o = JSON.parse(line);
        seen.add((o.author || '') + '|' + (o.text || '').slice(0, 80));
      } catch {}
    }
  }

  const summary = [];
  for (const q of queries) {
    let added = 0;
    try {
      const url = `https://x.com/search?q=${encodeURIComponent(q)}&f=live`;
      await tab.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await tab.page
        .waitForSelector('article[data-testid="tweet"], [data-testid="emptyState"]', { timeout: 15000 })
        .catch(() => {});
      // Extrae acumulando por scroll (X virtualiza: no perder tuits intermedios).
      let items = await collectWhileScrolling(tab.page, scrolls);
      if (items.length === 0) {
        // reintento: la SPA a veces no ha pintado aún al momento del evaluate
        await tab.page.waitForTimeout(2000);
        items = await collectWhileScrolling(tab.page, 1);
      }
      for (const it of items) {
        const key = (it.author || '') + '|' + (it.text || '').slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        appendFileSync(POOL, JSON.stringify({ query: q, ...it }) + '\n');
        added++;
      }
    } catch (e) {
      summary.push({ query: q, error: e.message });
      continue;
    }
    summary.push({ query: q, added });
    await tab.page.waitForTimeout(1000);
  }

  const total = existsSync(POOL) ? readFileSync(POOL, 'utf8').split('\n').filter(Boolean).length : 0;
  emit(flags, { summary, poolTotal: total, file: POOL }, (d) =>
    d.summary.map((s) => (s.error ? `${s.query}: ERROR ${s.error}` : `${s.query}: +${s.added}`)).join('\n') +
    `\n\npool total: ${d.poolTotal}`
  );
}

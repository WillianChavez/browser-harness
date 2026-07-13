import { connect, resolveActivePage } from '../session.js';
import { emit, fail } from '../output.js';

/**
 * Extrae los tuits visibles de la pestaña activa (timeline o resultados de búsqueda).
 * Autor (@handle), texto exacto y permalink real del tuit.
 */
export async function tweets(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);

  const scrolls = Number(flags.scroll || 0);
  for (let i = 0; i < scrolls; i++) {
    await tab.page.evaluate(() => window.scrollBy(0, 2000));
    await tab.page.waitForTimeout(1200);
  }

  const data = await tab.page.evaluate(() => {
    const arts = [...document.querySelectorAll('article[data-testid="tweet"]')];
    const seen = new Set();
    const out = [];
    for (const a of arts) {
      const textEl = a.querySelector('[data-testid="tweetText"]');
      const text = (textEl ? textEl.innerText : '').trim();
      if (!text) continue;

      // permalink: <a href="/user/status/123..."> dentro del bloque de tiempo
      const timeLink = a.querySelector('time')?.closest('a[href*="/status/"]');
      const permalink = timeLink ? new URL(timeLink.getAttribute('href'), location.origin).href.split('?')[0] : '';

      // handle: primer link a /usuario (no /status/) dentro del header del autor
      const userLinks = [...a.querySelectorAll('a[href^="/"]')].filter(
        (x) => /^\/[A-Za-z0-9_]+$/.test(x.getAttribute('href') || '')
      );
      const author = userLinks.length ? userLinks[0].getAttribute('href').slice(1) : '';

      const key = author + '|' + text.slice(0, 80);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ author, permalink, text: text.slice(0, 1500) });
    }
    return { url: location.href, count: out.length, items: out };
  });

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

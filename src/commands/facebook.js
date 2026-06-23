import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect, resolveActivePage } from '../session.js';
import { WORKSPACE } from '../config.js';
import { emit, fail } from '../output.js';

const HARVEST = resolve(WORKSPACE, 'harvest.jsonl');

// ---- lógica de extracción (se ejecuta dentro de la página) ----

function pageExtractFn() {
  const NOISE = /^(me gusta|responder|compartir|editado|ver traducci[oó]n|ver original.*|top fan|fan destacado|seguir|más relevantes|más recientes|todos los comentarios|ver más comentarios|ver más respuestas|autor|like|reply|share|edited|view translation|\d+\s*(min|h|d|sem|años?|a)|hace .*|\d+[.,]?\d*\s*(mil|mill)?\.?\s*$|·|seguidores?|\d+ comentarios?|\d+ veces compartido)$/i;
  function cleanText(raw, author) {
    const lines = (raw || '').split('\n').map((l) => l.trim()).filter(Boolean);
    const body = [];
    for (const l of lines) {
      if (author && (l === author || author.startsWith(l) || l.startsWith(author))) continue;
      if (NOISE.test(l)) continue;
      body.push(l);
    }
    return body.join('\n').trim();
  }
  function cleanLink(href) {
    try {
      const u = new URL(href);
      const cid = u.searchParams.get('comment_id');
      const rid = u.searchParams.get('reply_comment_id');
      const qs = [];
      if (cid) qs.push('comment_id=' + cid);
      if (rid) qs.push('reply_comment_id=' + rid);
      return u.origin + u.pathname + (qs.length ? '?' + qs.join('&') : '');
    } catch {
      return (href || '').split('&__cft__')[0];
    }
  }
  const arts = [...document.querySelectorAll('div[role="article"]')];
  const seen = new Set();
  const out = [];
  for (const a of arts) {
    const label = a.getAttribute('aria-label') || '';
    const author = label
      .replace(/^Comentario de\s*/i, '').replace(/^Comment by\s*/i, '')
      .replace(/^Respuesta de\s*/i, '').replace(/^Reply by\s*/i, '')
      .replace(/\s*al comentario de.*$/i, '').replace(/\s*to .*'s comment.*$/i, '')
      .replace(/\s*·.*$/, '').replace(/\s+hace\s+.*$/i, '')
      .replace(/\s+\d+\s*(min|h|d|sem|años?).*$/i, '').trim();
    let permalink = '';
    const anchors = [...a.querySelectorAll('a[href]')];
    const c = anchors.find((x) => /comment_id=|reply_comment_id=/.test(x.href));
    if (c) permalink = cleanLink(c.href);
    const text = cleanText(a.innerText, author);
    const key = author + '|' + text.slice(0, 80);
    if (!text || text.length < 2 || seen.has(key)) continue;
    seen.add(key);
    out.push({ author, permalink, text: text.slice(0, 1500) });
  }
  return { url: location.href, count: out.length, items: out };
}

async function pageExpandFn(rounds) {
  function clickMore() {
    let n = 0;
    const els = [...document.querySelectorAll('span, div[role="button"]')];
    for (const e of els) {
      const t = (e.innerText || '').trim().toLowerCase();
      if (/^(ver más comentarios|ver \d+ comentario|view more comments|ver más respuestas|ver \d+ respuesta|view \d+ repl|ver respuestas anteriores)/.test(t)) {
        try { e.click(); n++; } catch {}
      }
    }
    return n;
  }
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    total += clickMore();
    window.scrollBy(0, 2200);
    await new Promise((r) => setTimeout(r, 1600));
  }
  return total;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normaliza una entrada a URL: slug de página -> https://www.facebook.com/<slug>. */
function fbUrl(input) {
  if (input.startsWith('http')) return input;
  if (input.includes('.')) return `https://${input}`;
  return `https://www.facebook.com/${input.replace(/^\/+/, '')}`;
}

// ---- comandos ----

export async function comments(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const data = await tab.page.evaluate(pageExtractFn);
  emit(flags, data, (d) =>
    `${d.count} comentarios en ${d.url}\n\n` +
    d.items.map((it, i) => `[${i}] @${it.author || '?'}\n${it.text}\n${it.permalink || '(sin link)'}`).join('\n\n---\n')
  );
}

/** Recolecta permalinks de posts del feed de una página (o de la pestaña activa). */
export async function posts(args, flags) {
  const url = args[0];
  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);
  if (url) await tab.page.goto(fbUrl(url), { waitUntil: 'domcontentloaded', timeout: 45000 });
  await sleep(3000);
  const max = Number(flags.max || 30);
  const links = await tab.page.evaluate(async (max) => {
    const found = new Set();
    for (let i = 0; i < 18 && found.size < max; i++) {
      document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]').forEach((a) => {
        try {
          const u = new URL(a.href);
          if (/\/posts\/|\/permalink\//.test(u.pathname) || u.searchParams.get('story_fbid')) {
            let key = u.origin + u.pathname;
            const sf = u.searchParams.get('story_fbid');
            const id = u.searchParams.get('id');
            if (sf) key += `?story_fbid=${sf}${id ? '&id=' + id : ''}`;
            found.add(key);
          }
        } catch {}
      });
      window.scrollTo(0, document.body.scrollHeight);
      await new Promise((r) => setTimeout(r, 1600));
    }
    return [...found].slice(0, max);
  }, max);
  emit(flags, { count: links.length, posts: links }, (d) => `${d.count} posts\n` + d.posts.join('\n'));
}

/** Expande comentarios de la pestaña activa (clic en "ver más" + scroll). */
export async function expand(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const rounds = Number(flags.rounds || 6);
  const clicks = await tab.page.evaluate(pageExpandFn, rounds);
  const after = await tab.page.evaluate(() => document.querySelectorAll('div[role="article"]').length);
  emit(flags, { clicks, articles: after }, (d) => `expand: ${d.clicks} clics, ${d.articles} bloques`);
}

/**
 * Cosecha comentarios de una lista de URLs de POSTS directos (los que me pase el usuario).
 * uso: bh fb grab --posts "url1,url2" [--rounds 6]
 */
export async function grab(args, flags) {
  const urls = (flags.posts || args.join(',') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!urls.length) return fail(flags, 'uso: bh fb grab --posts "url1,url2,..."');
  const rounds = Number(flags.rounds || 6);
  const { browser } = await connect();
  const ctx = browser.contexts()[0] || (await browser.newContext());
  let page = await ctx.newPage();

  const seen = new Set();
  if (existsSync(HARVEST)) {
    for (const line of readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); seen.add((o.author || '') + '|' + (o.text || '').slice(0, 80)); } catch {}
    }
  }

  let added = 0;
  for (const postUrl of urls) {
    try {
      if (page.isClosed()) page = await ctx.newPage();
      await page.goto(postUrl.startsWith('http') ? postUrl : `https://${postUrl}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(2500);
      await page.evaluate(pageExpandFn, rounds);
      const data = await page.evaluate(pageExtractFn);
      for (const it of data.items) {
        const key = (it.author || '') + '|' + (it.text || '').slice(0, 80);
        if (seen.has(key)) continue;
        seen.add(key);
        appendFileSync(HARVEST, JSON.stringify({ postUrl, ...it }) + '\n');
        added++;
      }
    } catch {}
    await sleep(800);
  }
  await page.close().catch(() => {});
  const totalLines = existsSync(HARVEST) ? readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean).length : 0;
  emit(flags, { posts: urls.length, comments: added, harvestTotal: totalLines }, (d) => `+${d.comments} comentarios de ${d.posts} posts. harvest total: ${d.harvestTotal}`);
}

/**
 * Cosecha masiva: navega una página, recolecta posts, y por cada post expande y
 * extrae comentarios -> los agrega (JSONL) a workspace/harvest.jsonl con dedup global.
 */
export async function harvest(args, flags) {
  const pages = (flags.pages || args[0] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!pages.length) return fail(flags, 'uso: bh fb harvest --pages "url1,url2" [--max-posts 15] [--rounds 6]');
  const maxPosts = Number(flags['max-posts'] || 12);
  const rounds = Number(flags.rounds || 5);

  const { browser } = await connect();
  const ctx = browser.contexts()[0] || (await browser.newContext());
  // pestaña DEDICADA (no secuestra la del usuario); se recrea si se cierra.
  let page = await ctx.newPage();
  async function ensurePage() {
    if (!page || page.isClosed()) page = await ctx.newPage();
    return page;
  }
  async function gotoSafe(url) {
    await ensurePage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (e) {
      if (/closed/i.test(e.message)) {
        page = await ctx.newPage();
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
      } else throw e;
    }
  }

  // dedup global contra lo ya cosechado
  const seen = new Set();
  if (existsSync(HARVEST)) {
    for (const line of readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); seen.add((o.author || '') + '|' + (o.text || '').slice(0, 80)); } catch {}
    }
  }

  const summary = [];
  for (const pageUrl of pages) {
    let postLinks = [];
    try {
      await gotoSafe(fbUrl(pageUrl));
      await sleep(3000);
      const pairs = await page.evaluate(async (max) => {
        const found = new Map(); // key -> snippet de texto del post
        for (let i = 0; i < 20 && found.size < max * 3; i++) {
          document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]').forEach((a) => {
            try {
              const u = new URL(a.href);
              if (/\/posts\/|\/permalink\//.test(u.pathname) || u.searchParams.get('story_fbid')) {
                let key = u.origin + u.pathname;
                const sf = u.searchParams.get('story_fbid');
                const id = u.searchParams.get('id');
                if (sf) key += `?story_fbid=${sf}${id ? '&id=' + id : ''}`;
                if (!found.has(key)) {
                  let el = a, best = '';
                  for (let k = 0; k < 12 && el; k++) {
                    el = el.parentElement;
                    if (el && el.innerText && el.innerText.length > best.length) best = el.innerText;
                    if (best.length > 200) break;
                  }
                  found.set(key, best.slice(0, 500));
                }
              }
            } catch {}
          });
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise((r) => setTimeout(r, 1600));
        }
        return [...found.entries()].map(([key, text]) => ({ key, text }));
      }, maxPosts);

      // Filtro de tema: solo posts de crimen/violencia/política conflictiva (salvo --all)
      const CRIME = /pandill|marero|ms-?13|barrio ?18|homicid|asesin|matan|mat[oó]|capturad|crimen|delincuent|violaci[oó]n|viol[oó]|feminicid|narco|droga|extorsi|pen[ai]\b|c[aá]rcel|cecot|cad[aá]ver|balac|tiroteo|muert|terror|secuestr|r[eé]gimen|dictadura|corrupt/i;
      const useAll = flags.all;
      postLinks = pairs.filter((p) => useAll || CRIME.test(p.text)).map((p) => p.key).slice(0, maxPosts);
    } catch (e) {
      summary.push({ page: pageUrl, error: e.message });
      continue;
    }

    let added = 0;
    for (const postUrl of postLinks) {
      try {
        await gotoSafe(postUrl);
        await sleep(2500);
        await page.evaluate(pageExpandFn, rounds);
        const data = await page.evaluate(pageExtractFn);
        for (const it of data.items) {
          const key = (it.author || '') + '|' + (it.text || '').slice(0, 80);
          if (seen.has(key)) continue;
          seen.add(key);
          appendFileSync(HARVEST, JSON.stringify({ postUrl, ...it }) + '\n');
          added++;
        }
      } catch (e) {
        // post falló, seguir
      }
      await sleep(800);
    }
    summary.push({ page: pageUrl, posts: postLinks.length, comments: added });
  }

  await page.close().catch(() => {});
  const totalLines = existsSync(HARVEST) ? readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean).length : 0;
  emit(flags, { summary, harvestTotal: totalLines, file: HARVEST }, (d) =>
    d.summary.map((s) => s.error ? `${s.page}: ERROR ${s.error}` : `${s.page}: ${s.posts} posts, +${s.comments} comentarios`).join('\n') + `\n\nharvest total: ${d.harvestTotal}`
  );
}

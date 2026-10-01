import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { connect, resolveActivePage } from '../session.js';
import { WORKSPACE } from '../config.js';
import { emit, fail } from '../output.js';

const HARVEST = resolve(WORKSPACE, 'harvest.jsonl');
const SEEN_POSTS = resolve(WORKSPACE, 'seen_posts.jsonl');

// Tema: sucesos/captura/violencia. Sesga a amenazas reales, no insultos políticos.
// NOTA: un RegExp no cruza page.evaluate (se vuelve {}); se pasa CRIME.source como string.
const CRIME = /pandill|marero|ms-?13|barrio ?18|homicid|asesin|matan|matar|mat[oó]|capturad|detenid|arrestad|crimen|delincuent|violaci[oó]n|violen|feminicid|narco|extorsi|\breos?\b|penal|c[aá]rcel|cecot|cad[aá]ver|balac|tiroteo|disparo|arma\s+de\s+fuego|apu[ñn]al|pu[ñn]al|secuestr|masacr|terror|linchamiento|muert/i;

/** Ledger de posts ya cosechados por completo -> Map<key, ts(ms)>. */
function loadSeenPosts() {
  const map = new Map();
  if (existsSync(SEEN_POSTS)) {
    for (const line of readFileSync(SEEN_POSTS, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); if (o.key) map.set(o.key, o.ts || 0); } catch {}
    }
  }
  return map;
}

/** Registra (append) un post como cosechado. La misma key normalizada que postUrl en harvest.jsonl. */
function markPostDone(map, key, meta = {}) {
  const ts = Date.now();
  map.set(key, ts);
  appendFileSync(SEEN_POSTS, JSON.stringify({ key, ts, ...meta }) + '\n');
}

/**
 * Clave de dedup de comentarios: normaliza para que la MISMA reseña no se recapture
 * al re-cosechar un post. Quita el prefijo de tiempo relativo ("3 días") -- que cambia
 * entre cosechas -- y "GIPHY", colapsa espacios y baja a minúsculas.
 */
function dedupKey(author, text) {
  let t = (text || '').replace(/^\s*(hace\s+)?\d+\s*(min(utos?)?|h(oras?)?|d[ií]as?|sem(anas?)?|a[ñn]os?)\b\s*/i, '');
  t = t.replace(/giphy/ig, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return (author || '') + '|' + t.slice(0, 80);
}

// ---- lógica de extracción (se ejecuta dentro de la página) ----

function pageExtractFn() {
  // FB usa   (nbsp,  ) en vez de espacio normal en varias frases de UI -- \s cubre ambos.
  const NOISE = /^(me\s+gusta|responder|compartir|editado|ver\s+traducci[oó]n|ver\s+original.*|top\s+fan|fan\s+destacado|seguir|más\s+relevantes|más\s+recientes|todos\s+los\s+comentarios|ver\s+más\s+comentarios|ver\s+más\s+respuestas|autor|like|reply|share|edited|view\s+translation|\d+\s*(min|h|d|sem|años?|a)|hace\s+.*|\d+[.,]?\d*\s*(mil|mill)?\.?\s*$|·|seguidores?|\d+\s+comentarios?|\d+\s+veces\s+compartido)$/i;
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
      // FB usa   (nbsp) entre el número y la palabra (ej. "ver 1 respuesta") -- \s cubre ambos.
      if (/^(ver\s+más\s+comentarios|ver\s+\d+\s+comentario|view\s+more\s+comments|ver\s+más\s+respuestas|ver\s+\d+\s+respuesta|view\s+\d+\s+repl|ver\s+respuestas\s+anteriores)/.test(t)) {
        try { e.click(); n++; } catch {}
      }
    }
    return n;
  }
  // Reels/videos: los comentarios están detrás de un botón "Comentar" (no cargan solos).
  // Si casi no hay artículos, abrir el panel de comentarios primero.
  await (async () => {
    if (document.querySelectorAll('div[role="article"]').length >= 3) return;
    const cbtn = [...document.querySelectorAll('div[role="button"], [aria-label]')]
      .find((b) => /^(comentar|comment)$/i.test((b.getAttribute('aria-label') || '').trim()));
    if (cbtn) { try { cbtn.click(); } catch {} await new Promise((r) => setTimeout(r, 2500)); }
  })();
  // Inline (no llamar a helpers de módulo: page.evaluate sólo serializa ESTA función).
  // Cambia el orden a "Todos los comentarios" (FB oculta la mayoría bajo "Más relevantes").
  await (async () => {
    const byText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test((e.innerText || '').trim()));
    const sortBtn = byText('div[role="button"], span', /^(Más relevantes|Most relevant)$/);
    if (!sortBtn) return;
    try { sortBtn.click(); } catch { return; }
    await new Promise((r) => setTimeout(r, 700));
    const allOpt = byText('div[role="menuitem"], div[role="menuitemradio"]', /^(Todos los comentarios|All comments)/);
    if (!allOpt) return;
    try { allOpt.click(); } catch { return; }
    await new Promise((r) => setTimeout(r, 1200));
  })();
  // Completitud, no rondas ciegas: `rounds` es sólo el TOPE. Se detiene cuando
  // dos rondas seguidas no agregan artículos nuevos ni logran clics de "ver más"
  // (los comentarios dejaron de crecer -> post cargado por completo).
  const artCount = () => document.querySelectorAll('div[role="article"]').length;
  let total = 0;
  let prev = artCount();
  let stable = 0;
  let usedRounds = 0;
  for (let i = 0; i < rounds; i++) {
    usedRounds++;
    const clicks = clickMore();
    total += clicks;
    window.scrollBy(0, 2200);
    await new Promise((r) => setTimeout(r, 1600));
    const now = artCount();
    if (clicks === 0 && now === prev) {
      if (++stable >= 2) break; // nada nuevo dos veces -> completo
    } else {
      stable = 0;
    }
    prev = now;
  }
  return { clicks: total, rounds: usedRounds, articles: prev, complete: stable >= 2 };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normaliza una entrada a URL: slug de página -> https://www.facebook.com/<slug>. */
function fbUrl(input) {
  if (input.startsWith('http')) return input;
  // slugs de página pueden llevar punto (ej. "FGR.SV") -- solo tratar como
  // dominio externo si ya trae "www." o un path explícito.
  if (input.startsWith('www.') || input.includes('/')) return `https://${input}`;
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
  const r = await tab.page.evaluate(pageExpandFn, rounds);
  emit(flags, r, (d) =>
    `expand: ${d.clicks} clics, ${d.articles} bloques, ${d.rounds} rondas` +
    (d.complete ? ' (completo)' : ' (tope alcanzado, puede faltar)'));
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
      try { const o = JSON.parse(line); seen.add(dedupKey(o.author, o.text)); } catch {}
    }
  }

  let added = 0;
  let okPosts = 0;
  const failed = []; // { postUrl, error } -- no se tragan en silencio (regla 8)
  for (const postUrl of urls) {
    try {
      if (page.isClosed()) page = await ctx.newPage();
      await page.goto(postUrl.startsWith('http') ? postUrl : `https://${postUrl}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await sleep(2500);
      await page.evaluate(pageExpandFn, rounds);
      const data = await page.evaluate(pageExtractFn);
      for (const it of data.items) {
        const key = dedupKey(it.author, it.text);
        if (seen.has(key)) continue;
        seen.add(key);
        appendFileSync(HARVEST, JSON.stringify({ postUrl, ...it }) + '\n');
        added++;
      }
      okPosts++;
    } catch (e) {
      failed.push({ postUrl, error: String(e.message || e).replace(/\s+/g, ' ').slice(0, 200) });
    }
    await sleep(800);
  }
  await page.close().catch(() => {});
  const totalLines = existsSync(HARVEST) ? readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean).length : 0;
  emit(
    flags,
    { posts: urls.length, ok: okPosts, failed: failed.length, comments: added, harvestTotal: totalLines, ...(failed.length ? { errors: failed.slice(0, 10) } : {}) },
    (d) => `+${d.comments} comentarios de ${d.posts} posts (ok ${d.ok}, fallidos ${d.failed}). harvest total: ${d.harvestTotal}`
      + (d.failed ? `\nFALLIDOS:\n` + d.errors.map((e) => `  ${e.postUrl}: ${e.error}`).join('\n') : '')
  );
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

  // dedup global de comentarios (a nivel comentario, no post): evita duplicar filas.
  const seen = new Set();
  if (existsSync(HARVEST)) {
    for (const line of readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean)) {
      try { const o = JSON.parse(line); seen.add(dedupKey(o.author, o.text)); } catch {}
    }
  }

  // Ledger de posts = SÓLO los cosechados con el código actual (expand/sort/replies arreglados).
  // NO se siembra desde harvest.jsonl: esos 1270 posts se cosecharon superficialmente (~20
  // comentarios c/u) y ahora rinden mucho más al re-visitarlos; el dedup de comentarios evita
  // filas repetidas, así que re-profundizar es seguro y de alto rendimiento.
  const seenPosts = loadSeenPosts();
  const revisitMs = Number(flags['revisit-days'] || 0) * 86400000;
  const minComments = Number(flags['min-comments'] || 0);
  const nowMs = Date.now();
  // `activeSeen` = posts que SIGUEN vetados. Con revisit-days>0, los vistos hace
  // más que la ventana salen del set y vuelven a ser elegibles. El skip-guard por
  // post usa ESTE set (no el mapa completo), si no revisit-days quedaba anulado:
  // el descubrimiento resurgía el post viejo y el guard lo descartaba igual.
  const activeSeen = revisitMs > 0
    ? [...seenPosts].filter(([, ts]) => nowMs - ts < revisitMs).map(([k]) => k)
    : [...seenPosts.keys()];
  const activeSeenSet = new Set(activeSeen);

  const summary = [];
  for (const pageUrl of pages) {
    let postLinks = [];
    let considered = 0;
    try {
      await gotoSafe(fbUrl(pageUrl));
      await sleep(3000);
      // Descubrimiento: scrollea hasta juntar `max` posts FRESCOS de crimen (o hardCap scrolls).
      // Salta los ya cosechados (activeSeen) y, por defecto, sólo posts de tema crimen.
      const sel = await page.evaluate(async ({ max, seenKeys, crimeSrc, hardCap }) => {
        const seenSet = new Set(seenKeys);
        const CRIME = crimeSrc ? new RegExp(crimeSrc, 'i') : null;
        const isCrime = (t) => !CRIME || CRIME.test(t);
        const parseCount = (s) => {
          const m = /([\d.,]+)\s*(mil|k)?\s*(comentarios?|comments?)/i.exec(s || '');
          if (!m) return 0;
          let n = parseFloat(m[1].replace(/\.(?=\d{3}\b)/g, '').replace(',', '.')) || 0;
          if (/mil|k/i.test(m[2] || '')) n *= 1000;
          return Math.round(n);
        };
        const found = new Map(); // key -> { text, count }
        const freshCrime = () => {
          let c = 0;
          for (const [k, v] of found) if (!seenSet.has(k) && isCrime(v.text)) c++;
          return c;
        };
        for (let i = 0; i < hardCap && freshCrime() < max; i++) {
          document.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="story_fbid"]').forEach((a) => {
            try {
              const u = new URL(a.href);
              if (!(/\/posts\/|\/permalink\//.test(u.pathname) || u.searchParams.get('story_fbid'))) return;
              let key = u.origin + u.pathname;
              const sf = u.searchParams.get('story_fbid');
              const id = u.searchParams.get('id');
              if (sf) key += `?story_fbid=${sf}${id ? '&id=' + id : ''}`;
              if (found.has(key)) return;
              let el = a, best = '';
              for (let k = 0; k < 12 && el; k++) {
                el = el.parentElement;
                if (el && el.innerText && el.innerText.length > best.length) best = el.innerText;
                if (best.length > 200) break;
              }
              found.set(key, { text: best.slice(0, 500), count: parseCount(best) });
            } catch {}
          });
          window.scrollTo(0, document.body.scrollHeight);
          await new Promise((r) => setTimeout(r, 1600));
        }
        return [...found.entries()]
          .filter(([k, v]) => !seenSet.has(k) && isCrime(v.text))
          .sort((a, b) => b[1].count - a[1].count)
          .map(([key, v]) => ({ key, count: v.count }));
      }, { max: maxPosts, seenKeys: activeSeen, crimeSrc: flags.all ? null : CRIME.source, hardCap: 60 });

      considered = sel.length;
      postLinks = (minComments > 0 ? sel.filter((p) => p.count >= minComments) : sel)
        .map((p) => p.key)
        .slice(0, maxPosts);
    } catch (e) {
      summary.push({ page: pageUrl, error: e.message });
      continue;
    }

    let added = 0;
    let okPosts = 0;
    const failed = []; // { postUrl, error } -- NO se tragan en silencio (regla 8)
    for (const postUrl of postLinks) {
      // Skip-guard respeta la ventana de revisita (activeSeenSet), no el mapa completo.
      if (activeSeenSet.has(postUrl)) continue;
      try {
        await gotoSafe(postUrl);
        await sleep(2500);
        await page.evaluate(pageExpandFn, rounds);
        const data = await page.evaluate(pageExtractFn);
        let addedHere = 0;
        for (const it of data.items) {
          const key = dedupKey(it.author, it.text);
          if (seen.has(key)) continue;
          seen.add(key);
          appendFileSync(HARVEST, JSON.stringify({ postUrl, ...it }) + '\n');
          added++; addedHere++;
        }
        // Marcar SÓLO si extrajo sin lanzar (aunque todo haya deduplicado -> post agotado).
        // Un post que falló (tab cerrada, timeout) queda sin marcar y se reintenta luego.
        markPostDone(seenPosts, postUrl, { comments: data.count, added: addedHere });
        okPosts++;
      } catch (e) {
        failed.push({ postUrl, error: String(e.message || e).replace(/\s+/g, ' ').slice(0, 200) });
      }
      await sleep(800);
    }
    // Reportar ok/fallidos por separado: `posts` intentados != cosechados con éxito.
    summary.push({
      page: pageUrl,
      considered,
      attempted: postLinks.length,
      ok: okPosts,
      failed: failed.length,
      comments: added,
      ...(failed.length ? { errors: failed.slice(0, 5) } : {}),
    });
  }

  await page.close().catch(() => {});
  const totalLines = existsSync(HARVEST) ? readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean).length : 0;
  const postsFailed = summary.reduce((n, s) => n + (s.failed || 0), 0);
  const pagesFailed = summary.filter((s) => s.error).length;
  emit(flags, { summary, harvestTotal: totalLines, seenPostsTotal: seenPosts.size, postsFailed, pagesFailed, file: HARVEST }, (d) =>
    d.summary.map((s) => s.error
      ? `${s.page}: ERROR ${s.error}`
      : `${s.page}: ${s.considered ?? '?'} frescos, intentados ${s.attempted}, ok ${s.ok}, fallidos ${s.failed}, +${s.comments} comentarios`
        + (s.failed ? ` [${s.errors.map((e) => e.error).join(' | ')}]` : '')
    ).join('\n')
    + `\n\nharvest total: ${d.harvestTotal} | posts vistos (ledger): ${d.seenPostsTotal}`
    + ((postsFailed || pagesFailed) ? ` | FALLIDOS: ${postsFailed} posts, ${pagesFailed} páginas` : '')
  );
}

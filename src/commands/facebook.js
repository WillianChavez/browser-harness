import { connect, resolveActivePage } from '../session.js';
import { emit } from '../output.js';

/**
 * Extrae los comentarios/artículos visibles de la pestaña de Facebook activa.
 * Devuelve, por cada bloque: autor (de aria-label), texto y permalink (si lo halla).
 * Pensado para que el agente LEA y EVALÚE cada uno (no es harvesting ciego).
 */
export async function comments(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);

  const data = await tab.page.evaluate(() => {
    const NOISE = /^(me gusta|responder|compartir|editado|ver traducci[oó]n|top fan|seguir|más relevantes|ver más respuestas|autor|like|reply|share|edited|view translation|\d+\s*(min|h|d|sem|años?|a)|hace .*|\d+[.,]?\d*\s*(mil|mill)?\.?\s*$|·)$/i;

    function cleanText(raw, author) {
      const lines = (raw || '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
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
        // conserva solo comment_id / reply_comment_id si existen
        const cid = u.searchParams.get('comment_id');
        const rid = u.searchParams.get('reply_comment_id');
        let base = u.origin + u.pathname;
        const qs = [];
        if (cid) qs.push('comment_id=' + cid);
        if (rid) qs.push('reply_comment_id=' + rid);
        return base + (qs.length ? '?' + qs.join('&') : '');
      } catch {
        return href.split('&__cft__')[0];
      }
    }

    const arts = [...document.querySelectorAll('div[role="article"]')];
    const seen = new Set();
    const out = [];
    for (const a of arts) {
      const label = a.getAttribute('aria-label') || '';
      const author = label
        .replace(/^Comentario de\s*/i, '')
        .replace(/^Comment by\s*/i, '')
        .replace(/\s*·.*$/, '')
        .replace(/\s+hace\s+.*$/i, '')
        .replace(/\s+\d+\s*(min|h|d|sem|años?).*$/i, '')
        .trim();
      let permalink = '';
      const anchors = [...a.querySelectorAll('a[href]')];
      const c = anchors.find((x) =>
        /comment_id=|reply_comment_id=|\/posts\/|story_fbid=|\/permalink\//.test(x.href)
      );
      if (c) permalink = cleanLink(c.href);
      const text = cleanText(a.innerText, author);
      const key = author + '|' + text.slice(0, 80);
      if (!text || seen.has(key)) continue;
      seen.add(key);
      out.push({ author, permalink, text: text.slice(0, 1200) });
    }
    return { url: location.href, count: out.length, items: out };
  });

  emit(
    flags,
    data,
    (d) =>
      `${d.count} bloques en ${d.url}\n\n` +
      d.items
        .map((it, i) => `[${i}] @${it.author || '?'}\n${it.text}\n${it.permalink || '(sin link)'}`)
        .join('\n\n---\n')
  );
}

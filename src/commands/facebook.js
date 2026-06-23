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
    const arts = [...document.querySelectorAll('div[role="article"]')];
    const seen = new Set();
    const out = [];
    for (const a of arts) {
      const label = a.getAttribute('aria-label') || '';
      // autor: aria-label suele ser "Comentario de NOMBRE" / "Comment by NAME"
      const author = label.replace(/^Comentario de\s*/i, '').replace(/^Comment by\s*/i, '').trim();
      // permalink del comentario/post
      let permalink = '';
      const anchors = [...a.querySelectorAll('a[href]')];
      const c = anchors.find((x) =>
        /comment_id=|reply_comment_id=|\/posts\/|story_fbid=|\/permalink\//.test(x.href)
      );
      if (c) permalink = c.href.split('?')[0] + (c.href.includes('comment_id') ? '?' + c.href.split('?')[1] : '');
      // texto: innerText del artículo, recortando ruido obvio
      let text = (a.innerText || '').replace(/\s+\n/g, '\n').trim();
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

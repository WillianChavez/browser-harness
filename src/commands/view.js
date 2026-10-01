import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { connect, resolveActivePage, cdpSessionOf } from '../session.js';
import { WORKSPACE } from '../config.js';
import { emit, fail } from '../output.js';

function outPath(flags, prefix, ext) {
  if (flags.out) return resolve(flags.out);
  mkdirSync(WORKSPACE, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(WORKSPACE, `${prefix}-${stamp}.${ext}`);
}

export async function snapshot(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const aria = flags['no-aria'] ? null : await tab.page.locator('body').ariaSnapshot().catch(() => null);
  // Límite configurable (--max-chars) y señal explícita de truncado, para que el
  // modelo sepa que faltó contenido en vez de asumir que vio la página completa.
  // --full = sin límite.
  const full = await tab.page.innerText('body').catch(() => '');
  const maxChars = flags.full ? Infinity : Number(flags['max-chars'] || 20000);
  const truncated = full.length > maxChars;
  const text = truncated ? full.slice(0, maxChars) : full;
  emit(
    flags,
    { url: tab.page.url(), title: await tab.page.title(), aria, text, fullLength: full.length, truncated },
    (d) => `# ${d.title}\n${d.url}\n\n${d.text}` +
      (d.truncated ? `\n\n[…truncado: ${d.text.length}/${d.fullLength} chars. Usa --full o --max-chars N para más.]` : '')
  );
}

export async function screenshot(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  // JPEG por defecto (mucho más liviano que PNG); --png o --out x.png para PNG; --quality N (def. 70)
  const png = !!flags.png || /\.png$/i.test(String(flags.out || ''));
  const path = outPath(flags, 'shot', png ? 'png' : 'jpg');
  const quality = Number(flags.quality || 70);
  try {
    // Captura directa por CDP: no espera fuentes ni congela animaciones (evita cuelgues en páginas pesadas)
    const cdp = await cdpSessionOf(tab.page);
    const params = { format: png ? 'png' : 'jpeg', fromSurface: false, ...(png ? {} : { quality }) };
    if (flags.full) {
      const m = await cdp.send('Page.getLayoutMetrics');
      const sz = m.cssContentSize || m.contentSize;
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width: Math.ceil(sz.width), height: Math.min(Math.ceil(sz.height), 16000), scale: 1 };
    }
    const shot = await Promise.race([
      cdp.send('Page.captureScreenshot', params),
      new Promise((_, rej) => setTimeout(() => rej(new Error('captura CDP sin respuesta')), 8000)),
    ]);
    writeFileSync(path, Buffer.from(shot.data, 'base64'));
  } catch {
    // respaldo: Playwright (más lento) con tope corto
    await tab.page.screenshot({
      path, type: png ? 'png' : 'jpeg', ...(png ? {} : { quality }),
      fullPage: !!flags.full, timeout: 10000, animations: 'disabled', caret: 'hide',
    });
  }
  emit(flags, { path }, (d) => `MEDIA:${d.path}`);
}

export async function pdf(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const path = outPath(flags, 'page', 'pdf');
  try {
    await tab.page.pdf({ path });
  } catch (e) {
    return fail(flags, `pdf falló (requiere Chrome headless): ${e.message}`);
  }
  emit(flags, { path }, (d) => `MEDIA:${d.path}`);
}

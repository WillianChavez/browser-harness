import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { connect, resolveActivePage } from '../session.js';
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
  const aria = await tab.page.locator('body').ariaSnapshot().catch(() => null);
  const text = (await tab.page.innerText('body').catch(() => '')).slice(0, 4000);
  emit(
    flags,
    { url: tab.page.url(), title: await tab.page.title(), aria, text },
    (d) => `# ${d.title}\n${d.url}\n\n${d.text}`
  );
}

export async function screenshot(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const path = outPath(flags, 'shot', 'png');
  await tab.page.screenshot({ path, fullPage: !!flags.full });
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

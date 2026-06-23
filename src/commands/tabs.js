import { connect, listTabs, resolveActivePage, setActiveTarget, clearActiveTarget, targetIdOf } from '../session.js';
import { loadConfig } from '../config.js';
import { emit, fail } from '../output.js';

export async function tabs(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const list = await listTabs(browser);
  const active = (await resolveActivePage(browser, {}).catch(() => null))?.targetId;
  emit(
    flags,
    { tabs: list.map(({ page, ...t }) => ({ ...t, active: t.targetId === active })) },
    (d) =>
      d.tabs
        .map((t) => `${t.active ? '*' : ' '} [${t.index}] ${t.title || '(sin título)'} — ${t.url}`)
        .join('\n')
  );
}

export async function open(args, flags) {
  const url = args[0];
  if (!url) return fail(flags, 'falta la URL: bh open <url>');
  const { browser } = await connect();
  const ctx = browser.contexts()[0] || (await browser.newContext());
  const page = await ctx.newPage();
  await page.goto(normalize(url), { timeout: loadConfig().defaults.timeout, waitUntil: 'domcontentloaded' });
  const targetId = await targetIdOf(page).catch(() => null);
  if (targetId) setActiveTarget(targetId);
  emit(flags, { targetId, url: page.url(), title: await page.title() }, (d) => `abierta: ${d.title} — ${d.url}`);
}

export async function navigate(args, flags) {
  const url = args[0];
  if (!url) return fail(flags, 'falta la URL: bh navigate <url>');
  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);
  await tab.page.goto(normalize(url), { timeout: loadConfig().defaults.timeout, waitUntil: 'domcontentloaded' });
  if (tab.targetId) setActiveTarget(tab.targetId);
  emit(flags, { url: tab.page.url(), title: await tab.page.title() }, (d) => `→ ${d.title} — ${d.url}`);
}

export async function focus(args, flags) {
  const id = args[0] ?? flags.tab;
  if (id == null) return fail(flags, 'falta id/índice: bh focus <index|targetId>');
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, { tab: id });
  await tab.page.bringToFront().catch(() => {});
  if (tab.targetId) setActiveTarget(tab.targetId);
  emit(flags, { targetId: tab.targetId, url: tab.page.url(), title: await tab.page.title() }, (d) => `activa: ${d.title} — ${d.url}`);
}

export async function close(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const closedUrl = tab.page.url();
  await tab.page.close();
  if (tab.targetId) clearActiveTarget(tab.targetId);
  emit(flags, { closed: closedUrl }, (d) => `cerrada: ${d.closed}`);
}

function normalize(url) {
  return /^[a-zA-Z]+:\/\//.test(url) ? url : `https://${url}`;
}

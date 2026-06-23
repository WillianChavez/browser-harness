import { connect, resolveActivePage, setActiveTarget } from '../session.js';
import { loadConfig } from '../config.js';
import { emit, fail } from '../output.js';

async function active(flags) {
  const { browser } = await connect();
  const tab = await resolveActivePage(browser, flags);
  if (tab.targetId) setActiveTarget(tab.targetId);
  return tab;
}

const T = () => ({ timeout: loadConfig().defaults.timeout });

export async function click(args, flags) {
  const sel = args[0];
  if (!sel) return fail(flags, 'falta selector: bh click <selector>');
  const tab = await active(flags);
  await tab.page.click(sel, T());
  emit(flags, { clicked: sel, url: tab.page.url() }, (d) => `click: ${d.clicked}`);
}

export async function fill(args, flags) {
  const [sel, ...rest] = args;
  const value = rest.join(' ');
  if (!sel) return fail(flags, 'uso: bh fill <selector> <valor>');
  const tab = await active(flags);
  await tab.page.fill(sel, value, T());
  emit(flags, { filled: sel, value }, (d) => `fill: ${d.filled} = "${d.value}"`);
}

export async function type(args, flags) {
  const [sel, ...rest] = args;
  const text = rest.join(' ');
  if (!sel) return fail(flags, 'uso: bh type <selector> <texto>');
  const tab = await active(flags);
  await tab.page.locator(sel).pressSequentially(text, T());
  emit(flags, { typed: sel, text }, (d) => `type: ${d.typed}`);
}

export async function press(args, flags) {
  const key = args[0];
  if (!key) return fail(flags, 'uso: bh press <Key> [selector]');
  const sel = args[1];
  const tab = await active(flags);
  if (sel) await tab.page.press(sel, key, T());
  else await tab.page.keyboard.press(key);
  emit(flags, { key, selector: sel || null }, (d) => `press: ${d.key}`);
}

export async function hover(args, flags) {
  const sel = args[0];
  if (!sel) return fail(flags, 'uso: bh hover <selector>');
  const tab = await active(flags);
  await tab.page.hover(sel, T());
  emit(flags, { hovered: sel }, (d) => `hover: ${d.hovered}`);
}

export async function select(args, flags) {
  const [sel, ...values] = args;
  if (!sel || values.length === 0) return fail(flags, 'uso: bh select <selector> <valor...>');
  const tab = await active(flags);
  const result = await tab.page.selectOption(sel, values, T());
  emit(flags, { selector: sel, selected: result }, (d) => `select: ${d.selected.join(', ')}`);
}

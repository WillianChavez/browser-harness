import { connect, resolveActivePage } from '../session.js';
import { emit, fail } from '../output.js';

export async function evaluate(args, flags) {
  const expr = args.join(' ');
  if (!expr) return fail(flags, 'uso: bh eval "<javascript>"');
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  let result;
  try {
    result = await tab.page.evaluate((code) => {
      // eslint-disable-next-line no-eval
      const r = eval(code);
      return r;
    }, expr);
  } catch (e) {
    return fail(flags, `eval falló: ${e.message}`);
  }
  emit(flags, { result }, (d) => (typeof d.result === 'object' ? JSON.stringify(d.result, null, 2) : String(d.result)));
}

export async function cookies(args, flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const ctx = tab.page.context();
  if (args[0] === 'set') {
    const json = args.slice(1).join(' ');
    let arr;
    try {
      arr = JSON.parse(json);
    } catch {
      return fail(flags, 'cookies set requiere JSON array de cookies');
    }
    await ctx.addCookies(Array.isArray(arr) ? arr : [arr]);
    return emit(flags, { set: true }, () => 'cookies guardadas');
  }
  const list = await ctx.cookies(tab.page.url());
  emit(flags, { cookies: list }, (d) => d.cookies.map((c) => `${c.name}=${c.value}`).join('\n'));
}

export async function storage(args, flags) {
  const kind = args[0] === 'session' ? 'sessionStorage' : 'localStorage';
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  const data = await tab.page.evaluate((k) => ({ ...window[k] }), kind);
  emit(flags, { kind, data }, (d) => Object.entries(d.data).map(([k, v]) => `${k}=${v}`).join('\n'));
}

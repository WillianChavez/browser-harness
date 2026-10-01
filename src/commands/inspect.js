import { connect, resolveActivePage, setActiveTarget } from '../session.js';
import { loadConfig } from '../config.js';
import { emit, fail } from '../output.js';
import { resolveSel } from '../pageutil.js';

async function active(flags) {
  const { browser } = await connect({ allowLaunch: false });
  const tab = await resolveActivePage(browser, flags);
  if (tab.targetId) setActiveTarget(tab.targetId);
  return tab;
}

/** bh text [selector|@eN] [--max N] — texto visible de la página/elemento, sin ruido. */
export async function text(args, flags) {
  const tab = await active(flags);
  const sel = args[0] ? resolveSel(args[0]) : null;
  const max = Number(flags.max || 3000);
  const r = await tab.page.evaluate(
    ({ sel, max }) => {
      const el = sel ? document.querySelector(sel) : document.body;
      if (!el) return null;
      const t = el.innerText || '';
      return { len: t.length, text: t.slice(0, max) };
    },
    { sel, max }
  );
  if (!r) return fail(flags, `sin coincidencias para "${args[0]}"`);
  emit(
    flags,
    { url: tab.page.url(), length: r.len, truncated: r.len > max, text: r.text },
    (d) => d.text + (d.truncated ? `\n[…${d.length - max} chars más; usa --max N]` : '')
  );
}

// Se ejecuta DENTRO de la página. Marca cada elemento listado con data-bh-ref="eN"
// para poder accionarlo luego con `@eN` sin adivinar selectores.
function listElements({ scopeSel, max, all, match }) {
  document.querySelectorAll('[data-bh-ref]').forEach((e) => e.removeAttribute('data-bh-ref'));
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  let root = document;
  let scope = 'page';
  if (scopeSel) {
    const r = document.querySelector(scopeSel);
    if (!r) return { error: `el scope "${scopeSel}" no existe` };
    root = r;
    scope = scopeSel;
  } else {
    // sólo diálogos realmente modales: los widgets flotantes permanentes (p. ej. el chat de
    // LinkedIn, role=dialog de ~8% del viewport) NO deben ocultar el resto de la página
    const area = (el) => { const r = el.getBoundingClientRect(); return (r.width * r.height) / (innerWidth * innerHeight); };
    const isModal = (el) =>
      el.getAttribute('aria-modal') === 'true' ||
      el.matches('.modal.show') ||
      (el.matches('dialog[open]') && el.matches(':modal')) ||
      (['dialog', 'alertdialog'].includes(el.getAttribute('role')) && area(el) >= 0.2);
    const dlgs = [...document.querySelectorAll('[role=dialog],[role=alertdialog],dialog[open],.modal.show,[aria-modal=true]')].filter((d) => visible(d) && isModal(d));
    if (dlgs.length) {
      root = dlgs[dlgs.length - 1];
      scope = 'dialog';
      root.setAttribute('data-bh-ref', 'dialog'); // para `bh text @dialog`
    }
  }
  const SEL =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,label,[role=button],[role=link],[role=checkbox],[role=radio],[role=tab],[role=menuitem],[role=option],[role=switch],[role=combobox],[role=textbox],[role=listbox],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
  const cands = new Set(root.querySelectorAll(SEL));
  // componentes custom (mat-checkbox, react-select...) y elementos clicables por cursor
  root.querySelectorAll('*').forEach((el) => {
    if (cands.has(el)) return;
    if (el.tagName.includes('-')) cands.add(el);
    else if (['DIV', 'SPAN', 'LI', 'I'].includes(el.tagName) && el.children.length <= 3 && clean(el.innerText).length < 60 && getComputedStyle(el).cursor === 'pointer') cands.add(el);
  });
  const nameOf = (el) => {
    let n = el.getAttribute('aria-label');
    if (!n) {
      const lb = el.getAttribute('aria-labelledby');
      if (lb) n = lb.split(/\s+/).map((i) => document.getElementById(i)?.innerText || '').join(' ');
    }
    if (!n && el.labels && el.labels.length) n = [...el.labels].map((l) => l.innerText).join(' ');
    if (!n) n = el.placeholder || el.title || (el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes(el.type) ? el.value : '');
    if (!n) n = el.innerText || el.textContent || el.alt || '';
    if (!n && el.tagName === 'A') n = el.getAttribute('href') || '';
    // <label> vacío (texto en un contenedor/pseudo-elemento): usa el texto del contenedor
    if (!n && el.tagName === 'LABEL' && el.parentElement) n = el.parentElement.innerText;
    return clean(n).slice(0, 60);
  };
  const nearOf = (el) => {
    let cur = el;
    for (let i = 0; i < 4 && cur; i++) {
      let p = cur.previousElementSibling;
      while (p) {
        const t = clean(p.innerText);
        if (t && t.length <= 140) return t.slice(-70);
        p = p.previousElementSibling;
      }
      cur = cur.parentElement;
    }
    return '';
  };
  const roleOf = (el) => {
    const r = el.getAttribute('role');
    if (r) return r;
    const t = el.tagName;
    if (t === 'A') return 'link';
    if (t === 'BUTTON' || t === 'SUMMARY') return 'button';
    if (t === 'SELECT') return 'select';
    if (t === 'TEXTAREA') return 'textbox';
    if (t === 'INPUT') return ({ checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', file: 'file', range: 'slider' })[el.type] || 'textbox';
    return t.toLowerCase();
  };
  const rows = [];
  const included = [];
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  for (const el of cands) {
    if (!visible(el)) continue;
    // evita duplicar descendientes de un elemento ya listado (salvo campos de formulario)
    const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
    if (!isField && included.some((a) => a.contains(el))) continue;
    // un <label> cuyo control ya se lista (o es visible) es ruido duplicado
    if (el.tagName === 'LABEL' && el.control && visible(el.control)) continue;
    if (el.tagName === 'LABEL' && el.querySelector('input,select,textarea')) continue;
    const role = roleOf(el);
    const name = nameOf(el);
    if (!name && !isField && ['label', 'div', 'span', 'link', 'header', 'li', 'i'].includes(role)) continue; // sin nombre = ruido
    const near = isField || role === 'combobox' || role === 'textbox' ? nearOf(el) : '';
    const hay = (name + ' ' + near + ' ' + (el.value || '')).toLowerCase();
    if (match && !hay.includes(match.toLowerCase())) continue;
    included.push(el);
    rows.push({ el, role, name, near, isField, view: inView(el) });
  }
  const total = rows.length;
  rows.sort((x, y) => Number(y.view) - Number(x.view)); // lo visible en pantalla primero (orden DOM dentro de cada grupo)
  const items = [];
  for (const { el, role, name, near, isField, view } of rows.slice(0, max)) {
    const ref = 'e' + (items.length + 1);
    el.setAttribute('data-bh-ref', ref);
    const flagsOut = [];
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') flagsOut.push('disabled');
    if (el.required || el.getAttribute('aria-required') === 'true') flagsOut.push('required');
    if (el.checked || el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true') flagsOut.push('checked');
    if (el.getAttribute('aria-selected') === 'true') flagsOut.push('selected');
    if (el.getAttribute('aria-expanded') === 'true') flagsOut.push('expanded');
    if (el.readOnly) flagsOut.push('readonly');
    if (!view) flagsOut.push('off');
    let str = `${ref} ${role}`;
    if (name) str += ` "${name}"`;
    if (near && near !== name) str += ` near="${near}"`;
    if (isField && el.type !== 'checkbox' && el.type !== 'radio' && el.type !== 'file' && el.value) str += ` value="${el.type === 'password' ? '••••' : String(el.value).slice(0, 40)}"`;
    if (el.tagName === 'A') {
      const h = el.getAttribute('href') || '';
      if (h && !name.includes(h)) str += ` -> ${h.slice(0, 50)}`;
    }
    if (flagsOut.length) str += ` [${flagsOut.join(',')}]`;
    items.push(str);
  }
  return { scope, total, items };
}

/** bh els [scope] [--max N] [--all] [--match texto] — elementos interactivos visibles con refs @eN. */
export async function els(args, flags) {
  const tab = await active(flags);
  const max = flags.all ? 300 : Number(flags.max || 60);
  const r = await tab.page.evaluate(listElements, {
    scopeSel: args[0] ? resolveSel(args[0]) : null,
    max,
    all: !!flags.all,
    match: flags.match ? String(flags.match) : '',
  });
  if (r.error) return fail(flags, r.error);
  emit(
    flags,
    { url: tab.page.url(), scope: r.scope, shown: r.items.length, total: r.total, els: r.items },
    (d) =>
      `# ${d.scope} — ${d.shown}/${d.total}\n` + d.els.join('\n') + (d.total > d.shown ? `\n[…${d.total - d.shown} más; usa --max N, --all o --match texto]` : '')
  );
}

/** bh wait <selector|@eN|text=...|ms> [--gone] [--timeout ms] — espera una condición real, no un sleep ciego. */
export async function wait(args, flags) {
  const what = args.join(' ').trim();
  if (!what) return fail(flags, 'uso: bh wait <selector|@eN|text=...|ms> [--gone]');
  const t0 = Date.now();
  if (/^\d+$/.test(what)) {
    await new Promise((r) => setTimeout(r, Math.min(Number(what), 30000)));
    return emit(flags, { waited: Number(what), ms: Date.now() - t0 }, (d) => `esperé ${d.waited}ms`);
  }
  const tab = await active(flags);
  const sel = resolveSel(what);
  const timeout = Number(flags.timeout || loadConfig().defaults.actionTimeout || 6000);
  const state = flags.gone ? 'hidden' : 'visible';
  try {
    await tab.page.locator(sel).first().waitFor({ state, timeout });
  } catch {
    return fail(flags, `timeout (${timeout}ms) esperando ${flags.gone ? 'que desaparezca' : 'que aparezca'}: ${what}`);
  }
  emit(flags, { waitedFor: what, state, ms: Date.now() - t0 }, (d) => `${d.state}: ${d.waitedFor} (${d.ms}ms)`);
}

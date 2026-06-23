import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKSPACE } from '../config.js';
import { emit } from '../output.js';

const HARVEST = resolve(WORKSPACE, 'harvest.jsonl');
const DATA_JSON = resolve(WORKSPACE, 'dataset.json');

// Vocabulario de violencia/amenaza (acción de daño futuro / incitación), no solo insulto.
const VIOLENCE = [
  'te voy a', 'voy a matar', 'te mato', 'lo mato', 'los mato', 'te voy a matar',
  'matar', 'maten', 'mátenlo', 'mátenla', 'matenlos', 'matarlos', 'matarte', 'matarlo',
  'que lo maten', 'que los maten', 'hay que matar', 'ojalá lo maten', 'ojalá los maten',
  'muerte', 'muera', 'mueran', 'que se muera', 'que se mueran', 'ojalá se muera',
  'desaparecer', 'desaparezcan', 'desaparecido',
  'denle mona', 'denles mona', 'dale mona', 'mona',
  'plomo', 'balazo', 'balazos', 'bala', 'balas', 'tiro', 'tiros', 'disparen', 'disparar',
  'fusilar', 'fusilen', 'paredón', 'pena de muerte',
  'linchar', 'linchen', 'lincharlo',
  'golpiza', 'péguenle', 'peguenle', 'pegarle', 'partir la madre', 'romper la cara',
  'quemar', 'quemen', 'que ardan', 'que arda',
  'colgar', 'cuelguen', 'horca', 'ahorcar',
  'sacar a golpes', 'a verga', 'verguiar', 'verguear', 'cortarle', 'degollar',
  'eliminar', 'exterminar', 'acribillar', 'acribillen',
];

const norm = (s) => (s || '').toLowerCase();

export async function scan(args, flags) {
  if (!existsSync(HARVEST)) return emit(flags, { candidates: [], total: 0 }, () => 'no hay harvest.jsonl');
  const rows = existsSync(DATA_JSON) ? JSON.parse(readFileSync(DATA_JSON, 'utf8')) : [];
  const savedTexts = new Set(rows.map((r) => r.Texto_Original));

  const lines = readFileSync(HARVEST, 'utf8').split('\n').filter(Boolean);
  const seen = new Set();
  const cands = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const text = o.text || '';
    if (!text || savedTexts.has(text)) continue;
    const key = text.slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    const low = norm(text);
    const hits = VIOLENCE.filter((w) => low.includes(w));
    if (hits.length === 0) continue;
    cands.push({ score: hits.length, hits, author: o.author, text, permalink: o.permalink, postUrl: o.postUrl });
  }
  cands.sort((a, b) => b.score - a.score);

  const limit = Number(flags.max || 60);
  const top = cands.slice(0, limit);
  emit(
    flags,
    { total: cands.length, shown: top.length, candidates: top },
    (d) =>
      `candidatos con vocab. de violencia: ${d.total} (mostrando ${d.shown})\n\n` +
      d.candidates
        .map((c, i) => `[${i}] (${c.score}: ${c.hits.join(',')}) @${c.author}\n${c.text}\n${c.permalink || '(sin link)'}`)
        .join('\n\n---\n')
  );
}

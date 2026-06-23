import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORKSPACE } from '../config.js';
import { emit, fail } from '../output.js';

// Las 23 columnas del proyecto, en orden.
const COLUMNS = [
  'ID', 'Responsable', 'Plataforma', 'Fecha_Recolección', 'Texto_Original',
  'URL_Original', 'Usuario_ID_Anonimizado', 'Clase_Toxicidad', 'Subclase_Toxicidad',
  'Grupos_Afectados', 'Lenguaje_Dialectal', 'Presencia_Sarcasmo', 'Presencia_Ironia',
  'Contexto_Politico', 'Confianza_Clasificador', 'Notas_Etiquetador', 'Validado',
  'Validador', 'Fecha_Validacion', 'Acuerdo_Validador', 'Razon_Desacuerdo',
  'Cohen_Kappa', 'Listo_Entrenamiento',
];

const DATA_JSON = resolve(WORKSPACE, 'dataset.json'); // fuente de verdad
const CSV_FILE = resolve(WORKSPACE, 'dataset_willian.csv'); // export
const UMAP_FILE = resolve(WORKSPACE, 'user_map.json'); // autor -> USER_xxx
const ID_START = 501;

const DEFAULTS = {
  Responsable: 'Willian',
  Plataforma: 'Facebook',
  Validado: 'NO',
  Validador: '',
  Fecha_Validacion: '',
  Acuerdo_Validador: '',
  Razon_Desacuerdo: 'N/A',
  Cohen_Kappa: '',
  Listo_Entrenamiento: 'NO',
  Lenguaje_Dialectal: 'Salvadoreño',
  Presencia_Sarcasmo: 'NO',
  Presencia_Ironia: 'NO',
  Contexto_Politico: 'NO',
};

function load(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function ensureWs() {
  if (!existsSync(WORKSPACE)) mkdirSync(WORKSPACE, { recursive: true });
}

function escCsv(v) {
  v = v == null ? '' : String(v);
  return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

function writeCsv(rows) {
  const lines = [COLUMNS.join(',')];
  for (const r of rows) lines.push(COLUMNS.map((c) => escCsv(r[c])).join(','));
  writeFileSync(CSV_FILE, lines.join('\n') + '\n');
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Resuelve/crea el USER_xxx anonimizado para un autor. */
function resolveUser(author, umap) {
  const key = String(author || '').trim().toLowerCase();
  if (!key) {
    // autor desconocido -> id propio incremental anónimo
    const n = Object.keys(umap).length + 1;
    return `USER_${String(n).padStart(3, '0')}`;
  }
  if (umap[key]) return umap[key];
  const n = Object.keys(umap).length + 1;
  const id = `USER_${String(n).padStart(3, '0')}`;
  umap[key] = id;
  return id;
}

export async function add(args, flags) {
  const raw = flags.data;
  if (!raw) return fail(flags, 'uso: bh row add --data \'{"Texto_Original":"...","URL_Original":"...","author":"...","Clase_Toxicidad":"...",...}\'');
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return fail(flags, 'el --data no es JSON válido');
  }
  if (!input.Texto_Original) return fail(flags, 'falta Texto_Original');
  if (!input.URL_Original) return fail(flags, 'falta URL_Original');

  ensureWs();
  const rows = load(DATA_JSON, []);
  const umap = load(UMAP_FILE, {});

  const user = input.Usuario_ID_Anonimizado || resolveUser(input.author, umap);

  // dedup: mismo texto + mismo usuario
  const dup = rows.find(
    (r) => r.Texto_Original === input.Texto_Original && r.Usuario_ID_Anonimizado === user
  );
  if (dup) {
    return emit(flags, { added: false, duplicate: true, ID: dup.ID }, () => `duplicado de ID ${dup.ID}, no agregado`);
  }

  const maxId = rows.reduce((m, r) => Math.max(m, Number(r.ID) || 0), ID_START - 1);
  const row = {};
  for (const c of COLUMNS) row[c] = '';
  Object.assign(row, DEFAULTS);
  Object.assign(
    row,
    Object.fromEntries(Object.entries(input).filter(([k]) => COLUMNS.includes(k)))
  );
  row.ID = maxId + 1;
  row.Usuario_ID_Anonimizado = user;
  if (!row['Fecha_Recolección']) row['Fecha_Recolección'] = today();
  if (!row.Subclase_Toxicidad) row.Subclase_Toxicidad = row.Clase_Toxicidad === 'No Tóxico' ? 'N/A' : '';
  if (!row.Grupos_Afectados) row.Grupos_Afectados = row.Clase_Toxicidad === 'No Tóxico' ? 'N/A' : '';

  rows.push(row);
  writeFileSync(DATA_JSON, JSON.stringify(rows, null, 2));
  writeFileSync(UMAP_FILE, JSON.stringify(umap, null, 2));
  writeCsv(rows);

  emit(flags, { added: true, ID: row.ID, user, total: rows.length }, (d) => `+ ID ${d.ID} (${d.user}) — total ${d.total}`);
}

export async function count(args, flags) {
  const rows = load(DATA_JSON, []);
  const byClass = {};
  for (const r of rows) byClass[r.Clase_Toxicidad] = (byClass[r.Clase_Toxicidad] || 0) + 1;
  ensureWs();
  if (!existsSync(CSV_FILE)) writeCsv(rows); // inicializa CSV con cabecera
  emit(flags, { total: rows.length, byClass, csv: CSV_FILE }, (d) => `total: ${d.total}\n${JSON.stringify(d.byClass)}`);
}

import * as XLSX from 'xlsx';
import {
  DayEntry,
  EntriesMap,
  FieldKey,
  PacModel,
  Params,
  ReferenceData,
} from '../types/pac';
import {
  DEFAULT_YEAR_N1_LABELS,
  FIELDS,
  LABELS,
  PARAM_DEFAULT,
} from '../data/initialData';
import {
  addDaysIso,
  fmtDateFr,
  parseFrFloat,
  toDateIso,
} from './pacEngine';

function norm(s: unknown): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const HEADER_RULES: Record<'date' | FieldKey, (h: string) => boolean> = {
  date: (h) => h === 'date',
  temp: (h) => h.startsWith('temp') && h.includes('ext'),
  pac_conso: (h) => h.includes('pac') && h.includes('conso') && !h.includes('gaz'),
  pac_prod: (h) => h.includes('pac') && h.includes('produit'),
  cop_aff: (h) => h.includes('cop') && h.includes('affich'),
  edf_kwh: (h) => h.startsWith('edf') && h.includes('kwh'),
  edf_eur: (h) => h.startsWith('edf') && h.includes('€') && !h.includes('retenu'),
  gaz_kwh: (h) =>
    h.startsWith('gaz') && h.includes('kwh') && !h.includes('réf') && !h.includes('ref'),
  remarque: (h) => h.startsWith('remarque'),
};

const PARAM_RULES: Array<[keyof Params, string]> = [
  ['pe', 'prix électricité'],
  ['abo', 'abonnement électricité'],
  ['pg', 'prix gaz'],
  ['abg', 'abonnement gaz'],
  ['rend', 'rendement'],
  ['fen', 'fenêtre'],
  ['tol', 'tolérance "dans'],
  ['tolt', 'tolérance température'],
  ['cop_cible', 'cop cible'],
  ['cop_plancher', 'cop plancher'],
  ['start', 'date de mise en route'],
];

function findColumns(headerCells: unknown[]): Partial<Record<'date' | FieldKey, number>> {
  const cols: Partial<Record<'date' | FieldKey, number>> = {};
  headerCells.forEach((cell, i) => {
    const h = norm(cell);
    if (!h) return;
    (Object.keys(HEADER_RULES) as Array<'date' | FieldKey>).forEach((key) => {
      if (cols[key] === undefined && HEADER_RULES[key](h)) {
        cols[key] = i;
      }
    });
  });
  return cols;
}

function sheetToRows(wb: XLSX.WorkBook, sheetName: string): unknown[][] {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  });
}

export interface ExcelImportResult {
  reference: ReferenceData;
  entries: EntriesMap;
  importedCount: number;
}

export function importExcelFile(
  buffer: ArrayBuffer,
  fileName: string
): ExcelImportResult {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: false });
  const sheetByLower = new Map<string, string>();
  for (const name of wb.SheetNames) {
    sheetByLower.set(name.toLowerCase(), name);
  }

  const ref: ReferenceData = {
    params: { ...PARAM_DEFAULT },
    enedis: {},
    gaz: {},
    meteo: {},
    n1_total: {},
    year_n1: null,
    excelFileName: fileName,
    importedAt: new Date().toISOString(),
  };

  // 1. Paramètres
  const paramSheet = sheetByLower.get('paramètres');
  if (paramSheet) {
    const rows = sheetToRows(wb, paramSheet).slice(0, 45);
    const found = new Set<keyof Params>();
    for (const row of rows) {
      if (!row || row[0] === null) continue;
      const label = norm(row[0]).replace(/[“”]/g, '"');
      if (label.startsWith('contrôles')) break;
      for (const [key, frag] of PARAM_RULES) {
        if (!found.has(key) && label.startsWith(frag) && row.length > 1 && row[1] !== null) {
          found.add(key);
          if (key === 'start') {
            const d = toDateIso(row[1]);
            if (d) ref.params.start = d;
          } else {
            const v = parseFrFloat(row[1]);
            if (v !== null) {
              (ref.params[key] as number) = v;
            }
          }
        }
      }
    }
  }

  // 2. Données historiques
  const dataSheet = sheetByLower.get('données');
  if (dataSheet) {
    const rows = sheetToRows(wb, dataSheet).slice(3);
    for (const row of rows) {
      if (!row) continue;
      const d1 = toDateIso(row[0]);
      const k1 = parseFrFloat(row[1]);
      if (d1 && k1 !== null) ref.enedis[d1] = k1;

      const d2 = toDateIso(row[3]);
      const k2 = parseFrFloat(row[4]);
      if (d2 && k2 !== null) ref.gaz[d2] = k2;

      const d3 = toDateIso(row[6]);
      const k3 = parseFrFloat(row[7]);
      if (d3 && k3 !== null) ref.meteo[d3] = k3;
    }
  }

  // 3. Ref N-1
  const refSheet = sheetByLower.get('ref n-1');
  if (refSheet) {
    const rows = sheetToRows(wb, refSheet);
    for (let i = 2; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const d = toDateIso(row[0]);
      const v = parseFrFloat(row[9]);
      if (d && v !== null) ref.n1_total[d] = v;
    }

    let lab: string[] | null = null;
    let gaz: (number | null)[] | null = null;
    let elec: (number | null)[] | null = null;

    for (let i = 249; i < Math.min(rows.length, 430); i++) {
      const row = rows[i];
      if (!row) continue;
      const first = norm(row[11]);
      if (first === 'gaz' && !gaz) {
        gaz = Array.from({ length: 12 }, (_, idx) => parseFrFloat(row[12 + idx]));
      } else if ((first === 'élec' || first === 'elec') && !elec) {
        elec = Array.from({ length: 12 }, (_, idx) => parseFrFloat(row[12 + idx]));
      } else if (!lab && typeof row[12] === 'string' && ['oct', 'octobre'].includes(norm(row[12]))) {
        lab = Array.from({ length: 12 }, (_, idx) => String(row[12 + idx] ?? DEFAULT_YEAR_N1_LABELS[idx]));
      }
    }
    if (gaz && elec) {
      ref.year_n1 = {
        labels: lab || [...DEFAULT_YEAR_N1_LABELS],
        gaz,
        elec,
      };
    }
  }

  // 4. Verdict du jour (objectifs F16 = %, F17 = €)
  const verdictSheet = sheetByLower.get('verdict du jour');
  if (verdictSheet) {
    const ws = wb.Sheets[verdictSheet];
    const pCell = ws['F16']?.v;
    const eCell = ws['F17']?.v;
    const p = parseFrFloat(pCell);
    const e = parseFrFloat(eCell);
    if (p !== null && p > 0) ref.params.obj_pct = p;
    if (e !== null && e > 0) ref.params.obj_eur = e;
  }

  // 5. Journal
  const journalSheet = sheetByLower.get('journal');
  if (!journalSheet) {
    throw new Error('Feuille « Journal » introuvable dans le fichier Excel.');
  }
  const jRows = sheetToRows(wb, journalSheet).slice(0, 650);
  const hdrIdx = jRows.slice(0, 12).findIndex((r) => r && norm(r[0]) === 'date');
  if (hdrIdx < 0) {
    throw new Error('Ligne d’en-têtes (colonne « Date ») introuvable dans la feuille Journal.');
  }
  const cols = findColumns(jRows[hdrIdx]);
  const missing = FIELDS.filter((k) => cols[k] === undefined).map((k) => LABELS[k]);
  if (missing.length) {
    throw new Error('Colonnes introuvables dans Journal : ' + missing.join(', '));
  }

  const entries: EntriesMap = {};
  let prevIso: string | null = null;
  for (let i = hdrIdx + 1; i < jRows.length; i++) {
    const r = jRows[i];
    if (!r) continue;
    let dIso = toDateIso(r[0]);
    if (!dIso && prevIso) {
      dIso = addDaysIso(prevIso, 1);
    }
    if (!dIso) continue;
    prevIso = dIso;

    const e: DayEntry = {
      temp: null,
      pac_conso: null,
      pac_prod: null,
      cop_aff: null,
      edf_kwh: null,
      edf_eur: null,
      gaz_kwh: null,
      remarque: null,
    };
    let hasValue = false;
    for (const k of FIELDS) {
      const idx = cols[k]!;
      const raw = r[idx];
      if (k === 'remarque') {
        e.remarque = raw !== null && raw !== undefined && String(raw).trim() !== '' ? String(raw).trim() : null;
      } else {
        const val = parseFrFloat(raw);
        e[k] = val;
        if (val !== null) hasValue = true;
      }
    }
    if (hasValue) {
      entries[dIso] = e;
    }
  }

  return {
    reference: ref,
    entries,
    importedCount: Object.keys(entries).length,
  };
}

export function exportExcelWorkbook(model: PacModel, entries: EntriesMap): void {
  const wb = XLSX.utils.book_new();

  // Feuille Journal
  const journalHeader = [
    'Date',
    'Temp ext (°C)',
    'PAC conso (kWh)',
    'PAC produite (kWh)',
    'COP affiché',
    'EDF kWh',
    'EDF €',
    'Gaz kWh',
    'Dépense retenue (€)',
    'Réf N-1 (€)',
    'Réf moyenne (€)',
    'Économie N-1 (€)',
    'COP réel',
    'Élec hors PAC (kWh)',
    'Verdict',
    'Remarques',
  ];

  const byDate = new Map(model.days.map((d) => [d.date, d]));
  const sortedDates = Object.keys(entries).sort();
  const journalRows = sortedDates.map((iso) => {
    const e = entries[iso];
    const c = byDate.get(iso);
    return [
      fmtDateFr(iso),
      e.temp,
      e.pac_conso,
      e.pac_prod,
      e.cop_aff,
      e.edf_kwh,
      e.edf_eur,
      e.gaz_kwh,
      c?.depense !== null && c?.depense !== undefined ? Number(c.depense.toFixed(2)) : null,
      c?.ref_n1 !== null && c?.ref_n1 !== undefined ? Number(c.ref_n1.toFixed(2)) : null,
      c?.ref_mean !== null && c?.ref_mean !== undefined ? Number(c.ref_mean.toFixed(2)) : null,
      c?.eco_n1 !== null && c?.eco_n1 !== undefined ? Number(c.eco_n1.toFixed(2)) : null,
      c?.cop !== null && c?.cop !== undefined ? Number(c.cop.toFixed(2)) : null,
      c?.hors_pac !== null && c?.hors_pac !== undefined ? Number(c.hors_pac.toFixed(1)) : null,
      c?.verdict || '',
      e.remarque || '',
    ];
  });
  const wsJournal = XLSX.utils.aoa_to_sheet([journalHeader, ...journalRows]);
  XLSX.utils.book_append_sheet(wb, wsJournal, 'Journal');

  // Feuille Synthèse mensuelle
  const monthHeader = [
    'Mois',
    'Jours saisis',
    'Dépense EDF (€)',
    'Référence N-1 (€)',
    'Référence moyenne (€)',
    'Économie N-1 (€)',
    'Bénéfice N-1 (%)',
    'COP moyen',
  ];
  const monthRows = model.months.map((m) => [
    m.label,
    m.jours,
    Number(m.reel.toFixed(2)),
    m.ref_n1 !== null ? Number(m.ref_n1.toFixed(2)) : null,
    m.ref_mean !== null ? Number(m.ref_mean.toFixed(2)) : null,
    m.eco !== null ? Number(m.eco.toFixed(2)) : null,
    m.pct_n1 !== null ? Number((m.pct_n1 * 100).toFixed(1)) : null,
    m.cop !== null ? Number(m.cop.toFixed(2)) : null,
  ]);
  const wsMonths = XLSX.utils.aoa_to_sheet([monthHeader, ...monthRows]);
  XLSX.utils.book_append_sheet(wb, wsMonths, 'Synthèse mensuelle');

  // Feuille Paramètres
  const P = model.params;
  const paramRows = [
    ['Paramètre', 'Valeur'],
    ['Prix électricité (€/kWh)', P.pe],
    ['Abonnement électricité (€/j)', P.abo],
    ['Prix gaz (€/kWh)', P.pg],
    ['Abonnement gaz (€/j)', P.abg],
    ['Rendement gaz', P.rend],
    ['Fenêtre ± jours', P.fen],
    ['Tolérance dans la moyenne', P.tol],
    ['COP cible', Number(P.cop_cible.toFixed(2))],
    ['COP plancher', P.cop_plancher],
    ['Objectif économies (%)', P.obj_pct],
    ['Objectif économies (€)', P.obj_eur],
    ['Date de mise en route', fmtDateFr(P.start)],
  ];
  const wsParams = XLSX.utils.aoa_to_sheet(paramRows);
  XLSX.utils.book_append_sheet(wb, wsParams, 'Paramètres');

  XLSX.writeFile(wb, `Suivi_PAC_export_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export function exportEntriesJson(entries: EntriesMap): void {
  const blob = new Blob([JSON.stringify(entries, null, 1)], {
    type: 'application/json;charset=utf-8',
  });
  downloadBlob(blob, 'donnees_pac.json');
}

export function exportCsvJournal(model: PacModel): void {
  const headers = [
    'Date',
    'Temp (°C)',
    'PAC conso (kWh)',
    'PAC prod (kWh)',
    'COP affiché',
    'COP réel',
    'EDF (kWh)',
    'EDF (€)',
    'Dépense retenue (€)',
    'Réf N-1 (€)',
    'Économie N-1 (€)',
    'Gaz (kWh)',
    'Verdict',
    'Remarque',
  ];
  const lines = [headers.join(';')];
  for (const r of [...model.days].sort((a, b) => b.date.localeCompare(a.date))) {
    const row = [
      fmtDateFr(r.date),
      r.entry.temp ?? '',
      r.entry.pac_conso ?? '',
      r.entry.pac_prod ?? '',
      r.entry.cop_aff ?? '',
      r.cop !== null ? r.cop.toFixed(2) : '',
      r.entry.edf_kwh ?? '',
      r.entry.edf_eur ?? '',
      r.depense !== null ? r.depense.toFixed(2) : '',
      r.ref_n1 !== null ? r.ref_n1.toFixed(2) : '',
      r.eco_n1 !== null ? r.eco_n1.toFixed(2) : '',
      r.entry.gaz_kwh ?? '',
      r.verdict,
      (r.entry.remarque ?? '').replace(/;/g, ','),
    ];
    lines.push(row.join(';'));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  downloadBlob(blob, `suivi_pac_${new Date().toISOString().slice(0, 10)}.csv`);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

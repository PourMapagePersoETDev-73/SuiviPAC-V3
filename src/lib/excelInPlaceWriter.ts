import JSZip from 'jszip';
import { EntriesMap, FieldKey } from '../types/pac';
import { FIELDS } from '../data/initialData';
import { fmtDateFr } from './pacEngine';
import { downloadBlob } from './excelSync';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

const DB_NAME = 'suivi_pac_local_fs';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'suivi_pac_xlsx_handle';

interface FsPermissionDescriptor {
  mode?: 'read' | 'readwrite';
}

export interface LinkedFileHandle extends FileSystemFileHandle {
  queryPermission?: (desc?: FsPermissionDescriptor) => Promise<PermissionState>;
  requestPermission?: (desc?: FsPermissionDescriptor) => Promise<PermissionState>;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      multiple?: boolean;
      types?: Array<{
        description?: string;
        accept: Record<string, string[]>;
      }>;
    }) => Promise<LinkedFileHandle[]>;
  }
}

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

function findColumns(headerCells: (string | null)[]): Partial<Record<'date' | FieldKey, number>> {
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

function colLetter(idx: number): string {
  let s = '';
  let n = idx + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    s = String.fromCharCode(65 + rem) + s;
  }
  return s;
}

function colIndex(letters: string): number {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function toExcelSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

function ensureXmlDeclaration(xml: string): string {
  if (xml.startsWith('<?xml')) return xml;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${xml}`;
}

function directChildrenByTag(parent: Element, localName: string): Element[] {
  const out: Element[] = [];
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) {
      out.push(child);
    }
  }
  return out;
}

function firstDirectChild(parent: Element, localName: string): Element | null {
  for (let i = 0; i < parent.children.length; i++) {
    const child = parent.children[i];
    if (child.localName === localName) return child;
  }
  return null;
}

function getCellValue(cell: Element, sst: string[]): string | null {
  const v = firstDirectChild(cell, 'v');
  if (!v || v.textContent === null) {
    const isEl = firstDirectChild(cell, 'is');
    if (isEl) return isEl.textContent ?? null;
    return null;
  }
  if (cell.getAttribute('t') === 's') {
    const idx = Number(v.textContent);
    return Number.isFinite(idx) && sst[idx] !== undefined ? sst[idx] : v.textContent;
  }
  return v.textContent;
}

function setCellValue(
  doc: Document,
  rowEl: Element,
  rownum: number,
  col: number,
  value: number | string
): boolean {
  const ref = `${colLetter(col)}${rownum}`;
  const cells = directChildrenByTag(rowEl, 'c');
  let cell: Element | null = null;
  let insertBeforeEl: Element | null = null;

  for (const c of cells) {
    const rAttr = c.getAttribute('r') || '';
    if (rAttr === ref) {
      cell = c;
      break;
    }
    const lettersMatch = rAttr.match(/^[A-Z]+/);
    if (lettersMatch && colIndex(lettersMatch[0]) > col) {
      insertBeforeEl = c;
      break;
    }
  }

  if (!cell) {
    cell = doc.createElementNS(NS, 'c');
    cell.setAttribute('r', ref);
    if (insertBeforeEl) {
      rowEl.insertBefore(cell, insertBeforeEl);
    } else {
      rowEl.appendChild(cell);
    }
  }

  // Ne jamais modifier une cellule contenant une formule
  if (firstDirectChild(cell, 'f') !== null) {
    return false;
  }

  while (cell.firstChild) {
    cell.removeChild(cell.firstChild);
  }
  cell.removeAttribute('t');

  if (typeof value === 'string') {
    cell.setAttribute('t', 'inlineStr');
    const isEl = doc.createElementNS(NS, 'is');
    const tEl = doc.createElementNS(NS, 't');
    tEl.setAttributeNS(XML_NS, 'xml:space', 'preserve');
    tEl.textContent = value;
    isEl.appendChild(tEl);
    cell.appendChild(isEl);
  } else {
    const vEl = doc.createElementNS(NS, 'v');
    vEl.textContent = Number.isInteger(value) ? String(value) : String(value);
    cell.appendChild(vEl);
  }
  return true;
}

export async function patchJournalInXlsxBuffer(
  buffer: ArrayBuffer,
  entries: EntriesMap,
  onlyDates?: string[]
): Promise<{ blob: Blob; writtenCount: number; notFoundDates: string[] }> {
  const zip = await JSZip.loadAsync(buffer);
  const parser = new DOMParser();
  const serializer = new XMLSerializer();

  const wbEntry = zip.file('xl/workbook.xml');
  const relsEntry = zip.file('xl/_rels/workbook.xml.rels');
  if (!wbEntry || !relsEntry) {
    throw new Error('Structure Excel invalide (workbook.xml introuvable).');
  }

  const wbXmlText = await wbEntry.async('string');
  const wbDoc = parser.parseFromString(wbXmlText, 'application/xml');
  const sheetsEl = firstDirectChild(wbDoc.documentElement, 'sheets');
  if (!sheetsEl) {
    throw new Error('Liste des feuilles introuvable dans le classeur Excel.');
  }

  let journalRid: string | null = null;
  for (const s of directChildrenByTag(sheetsEl, 'sheet')) {
    if ((s.getAttribute('name') || '').toLowerCase() === 'journal') {
      journalRid = s.getAttribute('r:id') || s.getAttributeNS(RNS, 'id');
      break;
    }
  }
  if (!journalRid) {
    throw new Error('Feuille « Journal » introuvable dans votre fichier Excel.');
  }

  const relsXmlText = await relsEntry.async('string');
  const relsDoc = parser.parseFromString(relsXmlText, 'application/xml');
  let targetPath: string | null = null;
  for (const r of directChildrenByTag(relsDoc.documentElement, 'Relationship')) {
    if (r.getAttribute('Id') === journalRid) {
      targetPath = r.getAttribute('Target');
      break;
    }
  }
  if (!targetPath) {
    throw new Error('Chemin XML de la feuille Journal introuvable.');
  }

  const sheetPath = targetPath.startsWith('/')
    ? targetPath.slice(1)
    : targetPath.startsWith('xl/')
    ? targetPath
    : `xl/${targetPath}`;

  const sheetEntry = zip.file(sheetPath);
  if (!sheetEntry) {
    throw new Error(`Fichier interne Excel introuvable : ${sheetPath}`);
  }

  let sst: string[] = [];
  const sstEntry = zip.file('xl/sharedStrings.xml');
  if (sstEntry) {
    const sstText = await sstEntry.async('string');
    const sstDoc = parser.parseFromString(sstText, 'application/xml');
    sst = directChildrenByTag(sstDoc.documentElement, 'si').map(
      (si) => si.textContent ?? ''
    );
  }

  const sheetXmlText = await sheetEntry.async('string');
  const sheetDoc = parser.parseFromString(sheetXmlText, 'application/xml');
  const sheetData = firstDirectChild(sheetDoc.documentElement, 'sheetData');
  if (!sheetData) {
    throw new Error('Données de la feuille Journal introuvables.');
  }

  const rows = new Map<number, Element>();
  for (const rowEl of directChildrenByTag(sheetData, 'row')) {
    const rn = Number(rowEl.getAttribute('r'));
    if (Number.isFinite(rn) && rn > 0) {
      rows.set(rn, rowEl);
    }
  }

  const sortedRowNums = Array.from(rows.keys()).sort((a, b) => a - b);
  let hdrRow: number | null = null;
  for (const rn of sortedRowNums) {
    if (rn > 12) break;
    const rowEl = rows.get(rn)!;
    const firstCell = directChildrenByTag(rowEl, 'c')[0];
    if (firstCell && norm(getCellValue(firstCell, sst)) === 'date') {
      hdrRow = rn;
      break;
    }
  }
  if (hdrRow === null) {
    throw new Error('Ligne d’en-têtes (colonne « Date ») introuvable dans Journal.');
  }

  const hdrMap = new Map<number, string | null>();
  let maxHdrCol = 0;
  for (const c of directChildrenByTag(rows.get(hdrRow)!, 'c')) {
    const rAttr = c.getAttribute('r') || '';
    const m = rAttr.match(/^[A-Z]+/);
    if (!m) continue;
    const ci = colIndex(m[0]);
    maxHdrCol = Math.max(maxHdrCol, ci);
    hdrMap.set(ci, getCellValue(c, sst));
  }

  const hdrArr: (string | null)[] = [];
  for (let i = 0; i <= maxHdrCol; i++) {
    hdrArr.push(hdrMap.get(i) ?? null);
  }
  const cols = findColumns(hdrArr);

  const dateRows = new Map<number, number>();
  const firstRow = hdrRow + 1;
  for (const rn of sortedRowNums) {
    if (rn <= hdrRow) continue;
    const rowEl = rows.get(rn)!;
    const ca = directChildrenByTag(rowEl, 'c').find(
      (c) => c.getAttribute('r') === `A${rn}`
    );
    if (ca) {
      const rawVal = getCellValue(ca, sst);
      const parsed = rawVal !== null ? Number(rawVal) : NaN;
      if (Number.isFinite(parsed)) {
        dateRows.set(Math.trunc(parsed), rn);
      }
    }
  }

  let firstSerial: number | null = null;
  const firstRowEl = rows.get(firstRow);
  if (firstRowEl) {
    const ca = directChildrenByTag(firstRowEl, 'c').find(
      (c) => c.getAttribute('r') === `A${firstRow}`
    );
    if (ca) {
      const rawVal = getCellValue(ca, sst);
      const parsed = rawVal !== null ? Number(rawVal) : NaN;
      if (Number.isFinite(parsed)) {
        firstSerial = Math.trunc(parsed);
      }
    }
  }

  const onlySet = onlyDates ? new Set(onlyDates) : null;
  let writtenCount = 0;
  const notFoundDates: string[] = [];

  for (const iso of Object.keys(entries).sort()) {
    if (onlySet && !onlySet.has(iso)) continue;
    const entry = entries[iso];
    const serial = toExcelSerial(iso);
    let rn = dateRows.get(serial);
    if (rn === undefined && firstSerial !== null && serial >= firstSerial) {
      const guess = firstRow + (serial - firstSerial);
      if (rows.has(guess)) rn = guess;
    }
    if (rn === undefined || !rows.has(rn)) {
      notFoundDates.push(fmtDateFr(iso));
      continue;
    }

    const targetRow = rows.get(rn)!;
    for (const k of FIELDS) {
      const val = entry[k];
      const col = cols[k];
      if (val === null || val === undefined || col === undefined) continue;
      setCellValue(sheetDoc, targetRow, rn, col, val);
    }
    writtenCount++;
  }

  // Forcer Excel à recalculer les formules à l'ouverture
  let calcPr = firstDirectChild(wbDoc.documentElement, 'calcPr');
  if (!calcPr) {
    calcPr = wbDoc.createElementNS(NS, 'calcPr');
    const extLst = firstDirectChild(wbDoc.documentElement, 'extLst');
    if (extLst) {
      wbDoc.documentElement.insertBefore(calcPr, extLst);
    } else {
      wbDoc.documentElement.appendChild(calcPr);
    }
  }
  calcPr.setAttribute('fullCalcOnLoad', '1');

  const updatedSheetXml = ensureXmlDeclaration(
    serializer.serializeToString(sheetDoc)
  );
  const updatedWbXml = ensureXmlDeclaration(serializer.serializeToString(wbDoc));

  zip.file(sheetPath, updatedSheetXml);
  zip.file('xl/workbook.xml', updatedWbXml);

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  return { blob, writtenCount, notFoundDates };
}

/* --------------------------------------------------------------------------
 * Persistance locale du FileSystemFileHandle dans IndexedDB (Chrome / Edge PC)
 * -------------------------------------------------------------------------- */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.showOpenFilePicker === 'function'
  );
}

export function isBraveBrowser(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'brave' in navigator
  );
}

export function isInsideIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export async function patchAndDownloadExcelFile(
  file: File,
  entries: EntriesMap,
  onlyDates?: string[]
): Promise<{ fileName: string; writtenCount: number; notFoundDates: string[] }> {
  const buffer = await file.arrayBuffer();
  const { blob, writtenCount, notFoundDates } = await patchJournalInXlsxBuffer(
    buffer,
    entries,
    onlyDates
  );
  downloadBlob(blob, file.name);
  return { fileName: file.name, writtenCount, notFoundDates };
}

function openHandleDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSavedExcelHandle(): Promise<LinkedFileHandle | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const db = await openHandleDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as LinkedFileHandle) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function saveExcelHandle(handle: LinkedFileHandle): Promise<void> {
  const db = await openHandleDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(handle, HANDLE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearSavedExcelHandle(): Promise<void> {
  if (typeof indexedDB === 'undefined') return;
  try {
    const db = await openHandleDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(HANDLE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore cleanup errors
  }
}

export async function pickAndLinkExcelFile(): Promise<LinkedFileHandle> {
  if (!window.showOpenFilePicker) {
    if (isInsideIframe()) {
      throw new Error(
        'L’écriture directe sur disque est bloquée dans l’aperçu intégré. Ouvrez l’application installée sur votre PC (Edge, Chrome ou Brave avec flag activé).'
      );
    }
    if (isBraveBrowser()) {
      throw new Error(
        'Brave désactive l’écriture directe sur disque par défaut. Activez brave://flags/#file-system-access-api dans Brave (ou utilisez Microsoft Edge / Google Chrome), ou cliquez sur « Mettre à jour une copie de Suivi_PAC.xlsx » ci-dessous.'
      );
    }
    throw new Error(
      'Votre navigateur ne supporte pas l’écriture directe sur disque. Utilisez Google Chrome ou Microsoft Edge sur votre PC Windows, ou « Mettre à jour une copie de Suivi_PAC.xlsx » ci-dessous.'
    );
  }
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [
      {
        description: 'Classeur Excel (.xlsx, .xlsm)',
        accept: {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
            '.xlsx',
          ],
          'application/vnd.ms-excel.sheet.macroEnabled.12': ['.xlsm'],
        },
      },
    ],
  });
  await saveExcelHandle(handle);
  return handle;
}

async function ensureWritePermission(handle: LinkedFileHandle): Promise<boolean> {
  if (handle.queryPermission) {
    const state = await handle.queryPermission({ mode: 'readwrite' });
    if (state === 'granted') return true;
  }
  if (handle.requestPermission) {
    const req = await handle.requestPermission({ mode: 'readwrite' });
    return req === 'granted';
  }
  return true;
}

export async function writeEntriesToLinkedExcel(
  entries: EntriesMap,
  options?: { onlyDates?: string[]; forcePick?: boolean }
): Promise<{ fileName: string; writtenCount: number; notFoundDates: string[] }> {
  let handle = options?.forcePick ? null : await getSavedExcelHandle();
  if (!handle) {
    handle = await pickAndLinkExcelFile();
  }

  const granted = await ensureWritePermission(handle);
  if (!granted) {
    throw new Error(
      'Autorisation d’écriture refusée sur le fichier Excel. Autorisez la modification pour continuer.'
    );
  }

  let file: File;
  try {
    file = await handle.getFile();
  } catch {
    handle = await pickAndLinkExcelFile();
    file = await handle.getFile();
  }

  const buffer = await file.arrayBuffer();
  const { blob, writtenCount, notFoundDates } = await patchJournalInXlsxBuffer(
    buffer,
    entries,
    options?.onlyDates
  );

  try {
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.includes('lock') ||
      msg.includes('NoModificationAllowed') ||
      msg.includes('NotAllowed') ||
      msg.includes('InvalidState') ||
      (err instanceof DOMException &&
        ['NoModificationAllowedError', 'InvalidStateError', 'NotAllowedError'].includes(err.name))
    ) {
      throw new Error(
        `Le fichier « ${file.name} » semble ouvert ou verrouillé dans Excel. Fermez-le puis réessayez.`
      );
    }
    throw err;
  }

  return { fileName: file.name, writtenCount, notFoundDates };
}

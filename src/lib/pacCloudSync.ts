import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  ConsumptionGoals,
  DayEntry,
  EntriesMap,
  Params,
  ReferenceData,
  YearN1,
} from '../types/pac';
import {
  DEFAULT_CONSUMPTION_GOALS,
  DEFAULT_YEAR_N1_LABELS,
  EMPTY_REFERENCE,
  PARAM_DEFAULT,
} from '../data/initialData';
import { db, handleFirestoreError, OperationType } from './firebase';

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampNum(
  val: number | null | undefined,
  minVal: number,
  maxVal: number
): number | null {
  if (val === null || val === undefined || !Number.isFinite(val)) return null;
  return Math.max(minVal, Math.min(maxVal, val));
}

function sanitizeNumberMap(
  src: Record<string, number> | undefined | null,
  maxEntries = 2000
): Record<string, number> {
  if (!src || typeof src !== 'object') return {};
  const out: Record<string, number> = {};
  const keys = Object.keys(src).sort().slice(-maxEntries);
  for (const k of keys) {
    const v = src[k];
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k.slice(0, 32)] = v;
    }
  }
  return out;
}

function sanitizeDayEntryPayload(uid: string, dateIso: string, entry: DayEntry) {
  return {
    ownerId: uid,
    date: dateIso,
    temp: clampNum(entry.temp, -60, 65),
    pac_conso: clampNum(entry.pac_conso, 0, 5000),
    pac_prod: clampNum(entry.pac_prod, 0, 20000),
    cop_aff: clampNum(entry.cop_aff, 0, 20),
    edf_kwh: clampNum(entry.edf_kwh, 0, 5000),
    edf_eur: clampNum(entry.edf_eur, 0, 5000),
    gaz_kwh: clampNum(entry.gaz_kwh, 0, 5000),
    remarque:
      typeof entry.remarque === 'string' && entry.remarque.trim().length > 0
        ? entry.remarque.trim().slice(0, 500)
        : null,
    updatedAt: serverTimestamp(),
  };
}

function sanitizeParams(p: Params): Params {
  const num = (v: number, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return {
    pe: num(p.pe, PARAM_DEFAULT.pe),
    abo: num(p.abo, PARAM_DEFAULT.abo),
    pg: num(p.pg, PARAM_DEFAULT.pg),
    abg: num(p.abg, PARAM_DEFAULT.abg),
    rend: num(p.rend, PARAM_DEFAULT.rend),
    fen: num(p.fen, PARAM_DEFAULT.fen),
    tol: num(p.tol, PARAM_DEFAULT.tol),
    tolt: num(p.tolt, PARAM_DEFAULT.tolt),
    cop_cible: num(p.cop_cible, PARAM_DEFAULT.cop_cible),
    cop_plancher: num(p.cop_plancher, PARAM_DEFAULT.cop_plancher),
    start: ISO_DATE_RE.test(p.start) ? p.start : PARAM_DEFAULT.start,
    obj_pct: num(p.obj_pct, PARAM_DEFAULT.obj_pct),
    obj_eur: num(p.obj_eur, PARAM_DEFAULT.obj_eur),
  };
}

function sanitizeYearN1(yn: YearN1 | null): YearN1 | null {
  if (!yn) return null;
  const labels = Array.from({ length: 12 }, (_, i) =>
    String(yn.labels?.[i] ?? DEFAULT_YEAR_N1_LABELS[i]).slice(0, 20)
  );
  const gaz = Array.from({ length: 12 }, (_, i) => {
    const v = yn.gaz?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  const elec = Array.from({ length: 12 }, (_, i) => {
    const v = yn.elec?.[i];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  });
  return { labels, gaz, elec };
}

function sanitizeReferencePayload(uid: string, ref: ReferenceData) {
  return {
    ownerId: uid,
    params: sanitizeParams(ref.params),
    enedis: sanitizeNumberMap(ref.enedis, 2000),
    gaz: sanitizeNumberMap(ref.gaz, 2000),
    meteo: sanitizeNumberMap(ref.meteo, 2000),
    n1_total: sanitizeNumberMap(ref.n1_total, 2000),
    year_n1: sanitizeYearN1(ref.year_n1),
    excelFileName:
      typeof ref.excelFileName === 'string' && ref.excelFileName.trim()
        ? ref.excelFileName.trim().slice(0, 180)
        : null,
    importedAt:
      typeof ref.importedAt === 'string' && ref.importedAt.trim()
        ? ref.importedAt.trim().slice(0, 64)
        : null,
    updatedAt: serverTimestamp(),
  };
}

function sanitizeGoalsPayload(uid: string, goals: ConsumptionGoals) {
  const pos = (v: number | undefined, fallback: number) =>
    typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : fallback;

  const rawByMonth = goals.monthly?.byMonth || {};
  const byMonth: Record<string, Partial<Record<'pac_kwh' | 'edf_kwh' | 'edf_eur', number>>> = {};
  for (const ym of Object.keys(rawByMonth).sort().slice(-120)) {
    const src = rawByMonth[ym];
    if (!src || typeof src !== 'object') continue;
    const item: Partial<Record<'pac_kwh' | 'edf_kwh' | 'edf_eur', number>> = {};
    if (typeof src.pac_kwh === 'number' && Number.isFinite(src.pac_kwh) && src.pac_kwh > 0) {
      item.pac_kwh = src.pac_kwh;
    }
    if (typeof src.edf_kwh === 'number' && Number.isFinite(src.edf_kwh) && src.edf_kwh > 0) {
      item.edf_kwh = src.edf_kwh;
    }
    if (typeof src.edf_eur === 'number' && Number.isFinite(src.edf_eur) && src.edf_eur > 0) {
      item.edf_eur = src.edf_eur;
    }
    if (Object.keys(item).length > 0) {
      byMonth[ym.slice(0, 10)] = item;
    }
  }

  return {
    ownerId: uid,
    monthly: {
      pac_kwh: pos(goals.monthly?.pac_kwh, DEFAULT_CONSUMPTION_GOALS.monthly.pac_kwh),
      edf_kwh: pos(goals.monthly?.edf_kwh, DEFAULT_CONSUMPTION_GOALS.monthly.edf_kwh),
      edf_eur: pos(goals.monthly?.edf_eur, DEFAULT_CONSUMPTION_GOALS.monthly.edf_eur),
      byMonth,
    },
    annual: {
      pac_kwh: pos(goals.annual?.pac_kwh, DEFAULT_CONSUMPTION_GOALS.annual.pac_kwh),
      edf_kwh: pos(goals.annual?.edf_kwh, DEFAULT_CONSUMPTION_GOALS.annual.edf_kwh),
      edf_eur: pos(goals.annual?.edf_eur, DEFAULT_CONSUMPTION_GOALS.annual.edf_eur),
    },
    updatedAt: serverTimestamp(),
  };
}

export async function ensureUserWorkspace(user: User): Promise<void> {
  const path = `users/${user.uid}`;
  const ref = doc(db, 'users', user.uid);
  const displayName = (user.displayName || user.email || 'Utilisateur').slice(0, 120);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        ownerId: user.uid,
        displayName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        ref,
        {
          displayName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function bootstrapCloudWorkspaceIfEmpty(
  uid: string,
  localEntries: EntriesMap,
  localRef: ReferenceData,
  localGoals: ConsumptionGoals
): Promise<boolean> {
  const entriesColPath = `users/${uid}/entries`;
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid), limit(1))
    );
    const refSnap = await getDoc(doc(db, 'users', uid, 'reference', 'current'));
    const goalsSnap = await getDoc(doc(db, 'users', uid, 'goals', 'current'));

    let seeded = false;

    if (!refSnap.exists()) {
      await setDoc(
        doc(db, 'users', uid, 'reference', 'current'),
        sanitizeReferencePayload(uid, localRef)
      );
      seeded = true;
    }

    if (!goalsSnap.exists()) {
      await setDoc(
        doc(db, 'users', uid, 'goals', 'current'),
        sanitizeGoalsPayload(uid, localGoals)
      );
      seeded = true;
    }

    if (existingSnap.empty) {
      const validDates = Object.keys(localEntries)
        .filter((d) => ISO_DATE_RE.test(d))
        .sort();
      if (validDates.length > 0) {
        await batchUpsertEntriesToCloud(uid, localEntries);
        seeded = true;
      }
    }

    return seeded;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, entriesColPath);
  }
}

export function subscribeEntries(
  uid: string,
  onData: (entries: EntriesMap) => void,
  onError: (err: Error) => void
): () => void {
  const path = `users/${uid}/entries`;
  const q = query(collection(db, 'users', uid, 'entries'), where('ownerId', '==', uid));
  return onSnapshot(
    q,
    (snapshot) => {
      const next: EntriesMap = {};
      snapshot.forEach((docSnap) => {
        const d = docSnap.data();
        const date = typeof d.date === 'string' ? d.date : docSnap.id;
        if (!ISO_DATE_RE.test(date)) return;
        next[date] = {
          temp: typeof d.temp === 'number' ? d.temp : null,
          pac_conso: typeof d.pac_conso === 'number' ? d.pac_conso : null,
          pac_prod: typeof d.pac_prod === 'number' ? d.pac_prod : null,
          cop_aff: typeof d.cop_aff === 'number' ? d.cop_aff : null,
          edf_kwh: typeof d.edf_kwh === 'number' ? d.edf_kwh : null,
          edf_eur: typeof d.edf_eur === 'number' ? d.edf_eur : null,
          gaz_kwh: typeof d.gaz_kwh === 'number' ? d.gaz_kwh : null,
          remarque: typeof d.remarque === 'string' ? d.remarque : null,
        };
      });
      onData(next);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeReference(
  uid: string,
  onData: (ref: ReferenceData) => void,
  onError: (err: Error) => void
): () => void {
  const path = `users/${uid}/reference/current`;
  return onSnapshot(
    doc(db, 'users', uid, 'reference', 'current'),
    (snap) => {
      if (!snap.exists()) {
        onData(EMPTY_REFERENCE);
        return;
      }
      const d = snap.data();
      onData({
        params: sanitizeParams((d.params || PARAM_DEFAULT) as Params),
        enedis: (d.enedis || {}) as Record<string, number>,
        gaz: (d.gaz || {}) as Record<string, number>,
        meteo: (d.meteo || {}) as Record<string, number>,
        n1_total: (d.n1_total || {}) as Record<string, number>,
        year_n1: (d.year_n1 || null) as YearN1 | null,
        excelFileName: typeof d.excelFileName === 'string' ? d.excelFileName : null,
        importedAt: typeof d.importedAt === 'string' ? d.importedAt : null,
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeGoals(
  uid: string,
  onData: (goals: ConsumptionGoals) => void,
  onError: (err: Error) => void
): () => void {
  const path = `users/${uid}/goals/current`;
  return onSnapshot(
    doc(db, 'users', uid, 'goals', 'current'),
    (snap) => {
      if (!snap.exists()) {
        onData(DEFAULT_CONSUMPTION_GOALS);
        return;
      }
      const d = snap.data();
      onData({
        monthly: {
          pac_kwh: d.monthly?.pac_kwh ?? DEFAULT_CONSUMPTION_GOALS.monthly.pac_kwh,
          edf_kwh: d.monthly?.edf_kwh ?? DEFAULT_CONSUMPTION_GOALS.monthly.edf_kwh,
          edf_eur: d.monthly?.edf_eur ?? DEFAULT_CONSUMPTION_GOALS.monthly.edf_eur,
          byMonth: d.monthly?.byMonth || {},
        },
        annual: {
          pac_kwh: d.annual?.pac_kwh ?? DEFAULT_CONSUMPTION_GOALS.annual.pac_kwh,
          edf_kwh: d.annual?.edf_kwh ?? DEFAULT_CONSUMPTION_GOALS.annual.edf_kwh,
          edf_eur: d.annual?.edf_eur ?? DEFAULT_CONSUMPTION_GOALS.annual.edf_eur,
        },
      });
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.GET, path);
      } catch (wrapped) {
        onError(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function saveDayEntryToCloud(
  uid: string,
  dateIso: string,
  entry: DayEntry
): Promise<void> {
  if (!ISO_DATE_RE.test(dateIso)) {
    throw new Error(`Date ISO invalide : ${dateIso}`);
  }
  const path = `users/${uid}/entries/${dateIso}`;
  try {
    await setDoc(doc(db, 'users', uid, 'entries', dateIso), sanitizeDayEntryPayload(uid, dateIso, entry));
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteDayEntryFromCloud(
  uid: string,
  dateIso: string
): Promise<void> {
  if (!ISO_DATE_RE.test(dateIso)) {
    throw new Error(`Date ISO invalide : ${dateIso}`);
  }
  const path = `users/${uid}/entries/${dateIso}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'entries', dateIso));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function batchUpsertEntriesToCloud(
  uid: string,
  entries: EntriesMap
): Promise<void> {
  const keys = Object.keys(entries).filter((k) => ISO_DATE_RE.test(k)).sort();
  const path = `users/${uid}/entries`;
  try {
    for (let i = 0; i < keys.length; i += 400) {
      const chunk = keys.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const dateIso of chunk) {
        batch.set(
          doc(db, 'users', uid, 'entries', dateIso),
          sanitizeDayEntryPayload(uid, dateIso, entries[dateIso])
        );
      }
      await batch.commit();
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveReferenceToCloud(
  uid: string,
  refData: ReferenceData
): Promise<void> {
  const path = `users/${uid}/reference/current`;
  try {
    await setDoc(
      doc(db, 'users', uid, 'reference', 'current'),
      sanitizeReferencePayload(uid, refData)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveGoalsToCloud(
  uid: string,
  goals: ConsumptionGoals
): Promise<void> {
  const path = `users/${uid}/goals/current`;
  try {
    await setDoc(
      doc(db, 'users', uid, 'goals', 'current'),
      sanitizeGoalsPayload(uid, goals)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function replaceEntriesInCloud(
  uid: string,
  nextEntries: EntriesMap,
  previousDates: string[]
): Promise<void> {
  const path = `users/${uid}/entries`;
  try {
    const nextSet = new Set(Object.keys(nextEntries).filter((k) => ISO_DATE_RE.test(k)));
    const toDelete = previousDates.filter((d) => ISO_DATE_RE.test(d) && !nextSet.has(d));
    for (let i = 0; i < toDelete.length; i += 400) {
      const chunk = toDelete.slice(i, i + 400);
      const batch = writeBatch(db);
      for (const dateIso of chunk) {
        batch.delete(doc(db, 'users', uid, 'entries', dateIso));
      }
      await batch.commit();
    }
    await batchUpsertEntriesToCloud(uid, nextEntries);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}


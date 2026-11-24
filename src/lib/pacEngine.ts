import {
  ComputedDay,
  DayEntry,
  EntriesMap,
  FieldKey,
  GoalPeriod,
  KPI,
  MonthlySummary,
  PacModel,
  ReferenceData,
  TrajectoryPoint,
  VerdictType,
} from '../types/pac';
import { FIELDS } from '../data/initialData';

export function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
}

export function toIso(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function addDaysIso(iso: string, delta: number): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d + delta));
  return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function diffDaysIso(startIso: string, endIso: string): number {
  const a = parseIsoDate(startIso);
  const b = parseIsoDate(endIso);
  if (!a || !b) return 0;
  const msA = Date.UTC(a.y, a.m - 1, a.d);
  const msB = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((msB - msA) / 86400000);
}

export function edateIso(iso: string, months: number): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  const totalMonths = p.y * 12 + (p.m - 1) + months;
  const y = Math.floor(totalMonths / 12);
  const m = (totalMonths % 12) + 1;
  const maxD = daysInMonth(y, m);
  return toIso(y, m, Math.min(p.d, maxD));
}

export function todayIso(): string {
  const now = new Date();
  return toIso(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function fmtDateFr(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

export function fmtShortDateFr(iso: string): string {
  const p = parseIsoDate(iso);
  if (!p) return iso;
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}`;
}

export function fmtMonthFr(y: number, m: number): string {
  return `${String(m).padStart(2, '0')}/${y}`;
}

export function frNum(x: number | null | undefined, n = 2, signed = false): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  const absFormatted = Math.abs(x).toLocaleString('fr-FR', {
    minimumFractionDigits: n,
    maximumFractionDigits: n,
  });
  if (signed) {
    if (x > 0) return `+${absFormatted}`;
    if (x < 0) return `-${absFormatted}`;
  } else if (x < 0) {
    return `-${absFormatted}`;
  }
  return absFormatted;
}

export function parseFrFloat(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s+/g, '').replace(',', '.');
  if (!s) return null;
  const num = Number(s);
  return Number.isFinite(num) ? num : null;
}

export function toDateIso(v: unknown): string | null {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return toIso(v.getFullYear(), v.getMonth() + 1, v.getDate());
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 20000 && v < 80000) {
    // Excel serial date (epoch 1899-12-30)
    const ms = Date.UTC(1899, 11, 30) + Math.round(v) * 86400000;
    const dt = new Date(ms);
    return toIso(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
  }
  if (typeof v === 'string') {
    const s = v.trim();
    const frMatch = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
    if (frMatch) {
      return toIso(Number(frMatch[3]), Number(frMatch[2]), Number(frMatch[1]));
    }
    const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (isoMatch) {
      return toIso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3]));
    }
  }
  return null;
}

export function mergeEntries(
  base: EntriesMap,
  incoming: EntriesMap,
  overwrite = false
): EntriesMap {
  const out: EntriesMap = {};
  for (const [k, v] of Object.entries(base)) {
    out[k] = { ...v };
  }
  for (const [k, v] of Object.entries(incoming)) {
    const cur: Partial<DayEntry> = out[k] ? { ...out[k] } : {};
    for (const f of FIELDS) {
      const val = v[f];
      if (val !== null && val !== undefined && (overwrite || cur[f] === null || cur[f] === undefined)) {
        (cur as Record<FieldKey, unknown>)[f] = val;
      } else if (!(f in cur)) {
        (cur as Record<FieldKey, unknown>)[f] = val ?? null;
      }
    }
    out[k] = cur as DayEntry;
  }
  return out;
}

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

export function winAvg(series: Record<string, number>, centerIso: string, w: number): number | null {
  const vals: number[] = [];
  for (let i = -w; i <= w; i++) {
    const c = addDaysIso(centerIso, i);
    if (c in series && Number.isFinite(series[c])) {
      vals.push(series[c]);
    }
  }
  return mean(vals);
}

export function heatingYear(iso: string): [string, string] {
  const p = parseIsoDate(iso);
  if (!p) return ['2026-09-15', '2027-09-14'];
  const y = p.m > 9 || (p.m === 9 && p.d >= 15) ? p.y : p.y - 1;
  return [toIso(y, 9, 15), toIso(y + 1, 9, 14)];
}

export function computeDay(ref: ReferenceData, dIso: string, e: DayEntry): ComputedDay {
  const P = ref.params;
  const w = Math.round(P.fen);
  let depense: number | null = null;
  if (e.edf_eur !== null && e.edf_eur !== undefined) {
    depense = e.edf_eur;
  } else if (e.edf_kwh !== null && e.edf_kwh !== undefined) {
    depense = e.edf_kwh * P.pe + P.abo;
  }

  const cop =
    e.pac_prod !== null && e.pac_conso !== null && e.pac_conso > 0
      ? e.pac_prod / e.pac_conso
      : null;

  const hors_pac =
    e.edf_kwh !== null && e.pac_conso !== null ? e.edf_kwh - e.pac_conso : null;

  const elec_k: (number | null)[] = [];
  const tot_k: (number | null)[] = [];
  for (const k of [1, 2, 3]) {
    const c = edateIso(dIso, -12 * k);
    const el = winAvg(ref.enedis, c, w);
    const gz = winAvg(ref.gaz, c, w);
    elec_k.push(el);
    tot_k.push(
      el !== null && gz !== null ? el * P.pe + P.abo + gz * P.pg + P.abg : null
    );
  }

  const n1_real = ref.n1_total[edateIso(dIso, -12)] ?? null;
  const refs: [number | null, number | null, number | null] = [
    n1_real !== null ? n1_real : tot_k[0],
    tot_k[1],
    tot_k[2],
  ];

  // Fallback to monthly N-1 bill prorated if daily ref is absent and year_n1 exists
  if (refs[0] === null && ref.year_n1) {
    const p = parseIsoDate(dIso);
    if (p) {
      const order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
      const idx = order.indexOf(p.m);
      if (idx >= 0) {
        const g = ref.year_n1.gaz[idx];
        const el = ref.year_n1.elec[idx];
        if (g !== null && el !== null) {
          refs[0] = (g + el) / daysInMonth(p.y, p.m);
        }
      }
    }
  }

  const ok = refs.filter((x): x is number => x !== null);
  const oke = elec_k.filter((x): x is number => x !== null);
  const ref_n1 = refs[0];
  const ref_mean = mean(ok);
  const elec_ref_kwh = mean(oke);

  const pooled: number[] = [];
  for (const k of [1, 2, 3]) {
    const base = edateIso(dIso, -12 * k);
    for (let i = -w; i <= w; i++) {
      const c = addDaysIso(base, i);
      if (c in ref.meteo) pooled.push(ref.meteo[c]);
    }
  }
  const temp_ref = mean(pooled);

  const eco_n1 = depense !== null && ref_n1 !== null ? ref_n1 - depense : null;
  const benef_n1 = eco_n1 !== null && ref_n1 ? 1 - depense! / ref_n1 : null;
  const eco_mean = depense !== null && ref_mean !== null ? ref_mean - depense : null;
  const benef_mean = eco_mean !== null && ref_mean ? 1 - depense! / ref_mean : null;

  const base = benef_mean !== null ? benef_mean : benef_n1;
  let verdict: VerdictType = '';
  if (base !== null) {
    if (base > P.tol) verdict = "Moins cher que d'habitude";
    else if (base < -P.tol) verdict = "Plus cher que d'habitude";
    else verdict = 'Dans la moyenne';
  }

  return {
    date: dIso,
    entry: e,
    depense,
    total: depense,
    cop,
    hors_pac,
    refs,
    ref_n1,
    ref_mean,
    elec_ref_kwh,
    temp_ref,
    eco_n1,
    benef_n1,
    eco_mean,
    benef_mean,
    verdict,
    cumul: null,
  };
}

export function n1ForCurve(ref: ReferenceData, dIso: string): number | null {
  const v = ref.n1_total[edateIso(dIso, -12)];
  if (v !== undefined && v !== null) return v;
  const yn = ref.year_n1;
  const p = parseIsoDate(dIso);
  if (yn && p) {
    const order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const idx = order.indexOf(p.m);
    if (idx >= 0) {
      const g = yn.gaz[idx];
      const e = yn.elec[idx];
      if (g !== null && e !== null) {
        return (g + e) / daysInMonth(p.y, p.m);
      }
    }
  }
  const P = ref.params;
  const w = Math.round(P.fen);
  const c = edateIso(dIso, -12);
  const el = winAvg(ref.enedis, c, w);
  const gz = winAvg(ref.gaz, c, w);
  return el !== null && gz !== null ? el * P.pe + P.abo + gz * P.pg + P.abg : null;
}

export function buildModel(ref: ReferenceData, entries: EntriesMap): PacModel {
  const P = ref.params;
  const sortedKeys = Object.keys(entries).sort();
  const days = sortedKeys.map((k) => computeDay(ref, k, entries[k]));
  const dj = days.filter((r) => r.depense !== null);
  const last = dj.length ? dj[dj.length - 1] : null;
  const [hy0, hy1] = heatingYear(last ? last.date : todayIso());
  const hy = dj.filter((r) => r.date >= hy0 && r.date <= hy1);
  const elig = hy.filter((r) => r.eco_n1 !== null);

  let cum = 0;
  for (const r of elig) {
    cum += r.eco_n1!;
    r.cumul = cum;
  }

  const lastParsed = last ? parseIsoDate(last.date) : null;
  const em = lastParsed
    ? elig.filter((r) => {
        const p = parseIsoDate(r.date);
        return p && p.y === lastParsed.y && p.m === lastParsed.m;
      })
    : [];
  const lastday = last && last.eco_n1 !== null ? last : null;

  // Monthly grouping for current heating year
  const groups = new Map<string, { y: number; m: number; rs: ComputedDay[] }>();
  for (const r of hy) {
    const p = parseIsoDate(r.date);
    if (!p) continue;
    const key = `${p.y}-${String(p.m).padStart(2, '0')}`;
    if (!groups.has(key)) groups.set(key, { y: p.y, m: p.m, rs: [] });
    groups.get(key)!.rs.push(r);
  }

  const months: MonthlySummary[] = [];
  for (const { y, m, rs } of Array.from(groups.values()).sort((a, b) =>
    a.y !== b.y ? a.y - b.y : a.m - b.m
  )) {
    const allN1 = rs.every((x) => x.ref_n1 !== null);
    const allMean = rs.every((x) => x.ref_mean !== null);
    const n1 = allN1 ? rs.reduce((s, x) => s + x.ref_n1!, 0) : null;
    const mm = allMean ? rs.reduce((s, x) => s + x.ref_mean!, 0) : null;
    const reel = rs.reduce((s, x) => s + x.depense!, 0);

    const both = rs.filter(
      (x) => x.entry.pac_conso !== null && x.entry.pac_prod !== null
    );
    const conso = both.reduce((s, x) => s + (x.entry.pac_conso || 0), 0);
    const prod = both.reduce((s, x) => s + (x.entry.pac_prod || 0), 0);

    const jm = daysInMonth(y, m);
    const jmPrec = daysInMonth(y - 1, m);
    let n1FullSum = 0;
    let hasFull = true;
    for (let d = 1; d <= jmPrec; d++) {
      const v = ref.n1_total[toIso(y - 1, m, d)];
      if (v === undefined || v === null) {
        hasFull = false;
        break;
      }
      n1FullSum += v;
    }

    months.push({
      label: fmtMonthFr(y, m),
      y,
      m,
      jours: rs.length,
      jours_mois: jm,
      partiel: rs.length < jm,
      ref_n1_full: hasFull ? n1FullSum : null,
      reel,
      total: reel,
      ref_n1: n1,
      ref_mean: mm,
      eco: n1 !== null ? n1 - reel : null,
      pct_n1: n1 ? 1 - reel / n1 : null,
      cop: conso > 0 ? prod / conso : null,
    });
  }

  // Annual trajectory
  const traj: TrajectoryPoint[] = [];
  const entered = new Map<string, ComputedDay>();
  for (const r of hy) entered.set(r.date, r);
  const lastD = last ? last.date : null;
  const firstD = hy.length ? hy[0].date : null;
  const totalDays = diffDaysIso(hy0, hy1);

  let cn = 0;
  let cr = 0;
  for (let i = 0; i <= totalDays; i++) {
    const d = addDaysIso(hy0, i);
    const n1d =
      lastD && d <= lastD
        ? ref.n1_total[edateIso(d, -12)] ?? n1ForCurve(ref, d)
        : n1ForCurve(ref, d);

    if (lastD && d <= lastD) {
      const r = entered.get(d);
      if (r && n1d !== null && r.depense !== null) {
        cn += n1d;
        cr += r.depense;
      } else if (r && n1d === null && r.depense !== null) {
        cr += r.depense;
      }
    } else if (n1d !== null) {
      cn += n1d;
    }

    traj.push({
      date: d,
      n1: cn,
      obj: cn * (1 - P.obj_pct),
      reel: firstD && lastD && firstD <= d && d <= lastD ? cr : null,
    });
  }

  const cops = days
    .filter((r) => r.cop !== null && r.date >= P.start)
    .map((r) => r.cop!);

  const kpi: KPI = {
    jours: hy.length,
    hy0,
    hy1,
    eco_cumul: elig.length ? cum : null,
    eco_mois: em.length ? em.reduce((s, r) => s + r.eco_n1!, 0) : null,
    eco_jour: lastday ? lastday.eco_n1 : null,
    benef_cumul: mean(elig.map((r) => r.benef_n1!).filter((x) => x !== null)),
    benef_mois: mean(em.map((r) => r.benef_n1!).filter((x) => x !== null)),
    benef_jour: lastday ? lastday.benef_n1 : null,
    obj_eur: P.obj_eur,
    obj_pct: P.obj_pct,
    cop_moyen: mean(cops),
    cop_rentab: P.pe / (P.pg / P.rend),
    cop_cible: P.cop_cible,
    mois: months.length ? months[months.length - 1] : null,
  };

  return {
    days,
    hy_days: hy,
    months,
    kpi,
    last,
    params: P,
    year_n1: ref.year_n1,
    traj,
  };
}

export function parseEcsCycles(remarque: string | null | undefined): string | null {
  if (!remarque) return null;
  const m = /cycles?\s*ecs\s*:\s*([0-9+]+)/i.exec(remarque);
  if (m) return m[1];
  if (/^\d+$/.test(remarque.trim())) return remarque.trim();
  return null;
}

export function hasN1References(ref: ReferenceData): boolean {
  return (
    Object.keys(ref.n1_total).length > 0 ||
    Object.keys(ref.enedis).length > 0 ||
    ref.year_n1 !== null
  );
}

export interface ThermalModel {
  sampleSize: number;
  baseEurPerDay: number;
  slopeEurPerDju: number;
  djuBase: number;
  copMild: number | null;
  copCool: number | null;
}

export interface PeriodBudgetAnalysis {
  period: GoalPeriod;
  periodLabel: string;
  daysEnteredEur: number;
  totalPeriodDays: number;
  actualEur: number;
  n1SameDaysEur: number | null;
  n1SameDaysMatchedActualEur: number | null;
  n1FullPeriodEur: number | null;
  savingsSameDaysEur: number | null;
  savingsSameDaysPct: number | null;
  avgTempActual: number | null;
  avgTempRef: number | null;
  deltaTemp: number | null;
  djuActualSum: number | null;
  djuRefSum: number | null;
  climateNormalizedEur: number | null;
  climateNormalizedSavingsEur: number | null;
  climateNormalizedSavingsPct: number | null;
  projectedEur: number | null;
  projectionMethod: 'meteo' | 'saison_n1' | 'prorata' | null;
  projectionHint: string | null;
  recommendedBudgetEur: number | null;
  thermalModel: ThermalModel | null;
}

const DJU_BASE_C = 18;

function djuOf(tempC: number): number {
  return Math.max(0, DJU_BASE_C - tempC);
}

function refTempForDay(ref: ReferenceData, dIso: string): number | null {
  const w = Math.round(ref.params.fen);
  const pooled: number[] = [];
  for (const k of [1, 2, 3]) {
    const base = edateIso(dIso, -12 * k);
    for (let i = -w; i <= w; i++) {
      const c = addDaysIso(base, i);
      if (c in ref.meteo && Number.isFinite(ref.meteo[c])) {
        pooled.push(ref.meteo[c]);
      }
    }
  }
  return mean(pooled);
}

export function fitThermalModel(days: ComputedDay[], ref: ReferenceData): ThermalModel | null {
  const valid = days.filter(
    (d) =>
      d.entry.temp !== null &&
      d.depense !== null &&
      Number.isFinite(d.entry.temp) &&
      Number.isFinite(d.depense)
  );

  const copMildList = days
    .filter((d) => d.entry.temp !== null && d.entry.temp >= 12 && d.cop !== null)
    .map((d) => d.cop!);
  const copCoolList = days
    .filter((d) => d.entry.temp !== null && d.entry.temp < 12 && d.cop !== null)
    .map((d) => d.cop!);

  if (valid.length < 6) {
    return null;
  }

  const xs = valid.map((d) => djuOf(d.entry.temp!));
  const ys = valid.map((d) => d.depense!);
  const meanX = mean(xs)!;
  const meanY = mean(ys)!;

  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - meanX;
    sxx += dx * dx;
    sxy += dx * (ys[i] - meanY);
  }

  // Baseline spend estimate when no heating is needed (warm days or hors_pac)
  const horsPacEst = days
    .filter((d) => d.hors_pac !== null && d.hors_pac >= 0)
    .map((d) => d.hors_pac! * ref.params.pe + ref.params.abo);
  const warmDaysSpend = valid
    .filter((d) => d.entry.temp! >= 17)
    .map((d) => d.depense!);
  const fallbackBase =
    mean(horsPacEst) ??
    mean(warmDaysSpend) ??
    Math.min(meanY * 0.6, Math.min(...ys));
  const clampedFallbackBase = Math.max(0.5, Math.min(meanY * 0.85, fallbackBase));

  let slope = sxx > 4 ? sxy / sxx : 0;
  let intercept = meanY - slope * meanX;

  if (slope <= 0.05 || intercept < 0.2) {
    intercept = clampedFallbackBase;
    slope = meanX > 0.4 ? Math.max(0.05, (meanY - intercept) / meanX) : 0.25;
  }

  return {
    sampleSize: valid.length,
    baseEurPerDay: Math.max(0, intercept),
    slopeEurPerDju: Math.max(0.05, Math.min(4.5, slope)),
    djuBase: DJU_BASE_C,
    copMild: mean(copMildList),
    copCool: mean(copCoolList),
  };
}

export function analyzePeriodBudget(
  model: PacModel,
  ref: ReferenceData,
  period: GoalPeriod,
  selectedYm: string
): PeriodBudgetAnalysis {
  const k = model.kpi;
  const thermalModel = fitThermalModel(model.days, ref);

  let scopeDays: ComputedDay[] = [];
  let periodDates: string[] = [];
  let periodLabel = '';

  if (period === 'annual') {
    scopeDays = model.days.filter((d) => d.date >= k.hy0 && d.date <= k.hy1);
    const total = diffDaysIso(k.hy0, k.hy1) + 1;
    for (let i = 0; i < total; i++) {
      periodDates.push(addDaysIso(k.hy0, i));
    }
    periodLabel = `${fmtDateFr(k.hy0)} – ${fmtDateFr(k.hy1)}`;
  } else {
    scopeDays = model.days.filter((d) => d.date.startsWith(selectedYm));
    const [yStr, mStr] = selectedYm.split('-');
    const y = Number(yStr);
    const m = Number(mStr);
    if (y && m) {
      const dim = daysInMonth(y, m);
      for (let day = 1; day <= dim; day++) {
        periodDates.push(toIso(y, m, day));
      }
      periodLabel = `${String(m).padStart(2, '0')}/${y}`;
    } else {
      periodLabel = selectedYm;
    }
  }

  const totalPeriodDays = periodDates.length || (period === 'annual' ? 365 : 30);
  const daysWithSpend = scopeDays.filter((d) => d.depense !== null);
  const spendByDate = new Map<string, ComputedDay>();
  for (const d of daysWithSpend) spendByDate.set(d.date, d);

  const actualEur = daysWithSpend.reduce((s, d) => s + d.depense!, 0);

  const matchedN1 = daysWithSpend.filter((d) => d.ref_n1 !== null);
  const n1SameDaysEur =
    matchedN1.length > 0 ? matchedN1.reduce((s, d) => s + d.ref_n1!, 0) : null;
  const n1SameDaysMatchedActualEur =
    matchedN1.length > 0 ? matchedN1.reduce((s, d) => s + d.depense!, 0) : null;

  const savingsSameDaysEur =
    n1SameDaysEur !== null && n1SameDaysMatchedActualEur !== null
      ? n1SameDaysEur - n1SameDaysMatchedActualEur
      : null;
  const savingsSameDaysPct =
    n1SameDaysEur !== null && n1SameDaysEur > 0 && n1SameDaysMatchedActualEur !== null
      ? 1 - n1SameDaysMatchedActualEur / n1SameDaysEur
      : null;

  // Full period N-1 benchmark
  let n1FullSum = 0;
  let n1FullCount = 0;
  for (const dIso of periodDates) {
    const v = n1ForCurve(ref, dIso);
    if (v !== null && Number.isFinite(v)) {
      n1FullSum += v;
      n1FullCount += 1;
    }
  }
  const hasFullN1 =
    period === 'annual'
      ? n1FullCount >= 300
      : periodDates.length > 0 && n1FullCount === periodDates.length;
  const n1FullPeriodEur = hasFullN1 ? n1FullSum : null;

  const recommendedBudgetEur =
    n1FullPeriodEur !== null
      ? Math.max(1, Math.round(n1FullPeriodEur * (1 - k.obj_pct)))
      : null;

  // Weather & temperature comparison
  const tempDays = scopeDays.filter((d) => d.entry.temp !== null);
  const avgTempActual = tempDays.length
    ? mean(tempDays.map((d) => d.entry.temp!))
    : null;

  const tempPairs = scopeDays.filter(
    (d) => d.entry.temp !== null && d.temp_ref !== null
  );
  const avgTempRef = tempPairs.length
    ? mean(tempPairs.map((d) => d.temp_ref!))
    : null;
  const avgTempActualPairs = tempPairs.length
    ? mean(tempPairs.map((d) => d.entry.temp!))
    : null;
  const deltaTemp =
    avgTempActualPairs !== null && avgTempRef !== null
      ? avgTempActualPairs - avgTempRef
      : null;

  const djuActualSum = tempPairs.length
    ? tempPairs.reduce((s, d) => s + djuOf(d.entry.temp!), 0)
    : null;
  const djuRefSum = tempPairs.length
    ? tempPairs.reduce((s, d) => s + djuOf(d.temp_ref!), 0)
    : null;

  // Climate-normalized spend on entered days ("à températures N-1")
  let climateNormalizedEur: number | null = null;
  let climateNormalizedSavingsEur: number | null = null;
  let climateNormalizedSavingsPct: number | null = null;

  if (tempPairs.length >= 3 && daysWithSpend.length > 0 && thermalModel) {
    let normTotal = 0;
    let normMatched = 0;
    let pairSpendCount = 0;

    for (const d of daysWithSpend) {
      let adj = d.depense!;
      if (d.entry.temp !== null && d.temp_ref !== null) {
        pairSpendCount += 1;
        const deltaDju = djuOf(d.temp_ref) - djuOf(d.entry.temp);
        adj = Math.max(0.5, d.depense! + thermalModel.slopeEurPerDju * deltaDju);
      }
      normTotal += adj;
      if (d.ref_n1 !== null) {
        normMatched += adj;
      }
    }

    if (pairSpendCount >= 3) {
      climateNormalizedEur = normTotal;
      if (n1SameDaysEur !== null && n1SameDaysEur > 0) {
        climateNormalizedSavingsEur = n1SameDaysEur - normMatched;
        climateNormalizedSavingsPct = 1 - normMatched / n1SameDaysEur;
      }
    }
  }

  // End-of-period extrapolation (€)
  let projectedEur: number | null = null;
  let projectionMethod: PeriodBudgetAnalysis['projectionMethod'] = null;
  let projectionHint: string | null = null;

  if (daysWithSpend.length > 0) {
    const missingDates = periodDates.filter((dIso) => !spendByDate.has(dIso));

    if (missingDates.length === 0) {
      projectedEur = actualEur;
      projectionMethod = n1FullPeriodEur !== null ? 'saison_n1' : 'prorata';
      projectionHint = 'Période complète saisie';
    } else if (
      period === 'annual' &&
      n1FullPeriodEur !== null &&
      n1SameDaysEur !== null &&
      n1SameDaysEur > 0 &&
      n1SameDaysMatchedActualEur !== null
    ) {
      const ratioVsN1 = n1SameDaysMatchedActualEur / n1SameDaysEur;
      const remainingN1 = Math.max(0, n1FullPeriodEur - n1SameDaysEur);
      projectedEur = actualEur + remainingN1 * ratioVsN1;
      projectionMethod = 'saison_n1';
      projectionHint =
        "Basée sur la courbe saisonnière N-1 (intègre le poids réel de l'hiver)";
    } else if (period === 'monthly' && thermalModel) {
      let missingEst = 0;
      let meteoHits = 0;
      for (const dIso of missingDates) {
        const tRef = refTempForDay(ref, dIso);
        if (tRef !== null) {
          meteoHits += 1;
          missingEst +=
            thermalModel.baseEurPerDay +
            thermalModel.slopeEurPerDju * djuOf(tRef);
        }
      }
      if (meteoHits >= Math.max(1, Math.floor(missingDates.length * 0.6))) {
        const avgMissingEst = missingEst / meteoHits;
        projectedEur = actualEur + avgMissingEst * missingDates.length;
        projectionMethod = 'meteo';
        projectionHint =
          'Extrapolée avec votre sensibilité €/DJU et les températures historiques';
      } else if (
        n1FullPeriodEur !== null &&
        n1SameDaysEur !== null &&
        n1SameDaysEur > 0 &&
        n1SameDaysMatchedActualEur !== null
      ) {
        const ratioVsN1 = n1SameDaysMatchedActualEur / n1SameDaysEur;
        const remainingN1 = Math.max(0, n1FullPeriodEur - n1SameDaysEur);
        projectedEur = actualEur + remainingN1 * ratioVsN1;
        projectionMethod = 'saison_n1';
        projectionHint = 'Extrapolée selon le profil N-1 des jours restants du mois';
      } else {
        projectedEur = (actualEur / daysWithSpend.length) * totalPeriodDays;
        projectionMethod = 'prorata';
        projectionHint =
          'Prorata du rythme journalier (importez N-1/météo pour affiner)';
      }
    } else if (
      n1FullPeriodEur !== null &&
      n1SameDaysEur !== null &&
      n1SameDaysEur > 0 &&
      n1SameDaysMatchedActualEur !== null
    ) {
      const ratioVsN1 = n1SameDaysMatchedActualEur / n1SameDaysEur;
      const remainingN1 = Math.max(0, n1FullPeriodEur - n1SameDaysEur);
      projectedEur = actualEur + remainingN1 * ratioVsN1;
      projectionMethod = 'saison_n1';
      projectionHint = 'Extrapolée selon le profil saisonnier N-1';
    } else {
      projectedEur = (actualEur / daysWithSpend.length) * totalPeriodDays;
      projectionMethod = 'prorata';
      projectionHint =
        period === 'annual'
          ? "Prorata brut (l'hiver pèse plus lourd — importez N-1 pour extrapoler par saison)"
          : 'Prorata du rythme actuel sur le mois';
    }
  }

  return {
    period,
    periodLabel,
    daysEnteredEur: daysWithSpend.length,
    totalPeriodDays,
    actualEur,
    n1SameDaysEur,
    n1SameDaysMatchedActualEur,
    n1FullPeriodEur,
    savingsSameDaysEur,
    savingsSameDaysPct,
    avgTempActual,
    avgTempRef,
    deltaTemp,
    djuActualSum,
    djuRefSum,
    climateNormalizedEur,
    climateNormalizedSavingsEur,
    climateNormalizedSavingsPct,
    projectedEur,
    projectionMethod,
    projectionHint,
    recommendedBudgetEur,
    thermalModel,
  };
}

export function getLatestEnteredDate(entries: EntriesMap): string | null {
  const keys = Object.keys(entries).sort();
  if (!keys.length) return null;
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = entries[keys[i]];
    if (
      e &&
      ((e.edf_kwh !== null && e.edf_kwh !== undefined) ||
        (e.edf_eur !== null && e.edf_eur !== undefined))
    ) {
      return keys[i];
    }
  }
  for (let i = keys.length - 1; i >= 0; i--) {
    const e = entries[keys[i]];
    if (
      e &&
      FIELDS.some((k) => e[k] !== null && e[k] !== undefined && e[k] !== '')
    ) {
      return keys[i];
    }
  }
  return keys[keys.length - 1];
}



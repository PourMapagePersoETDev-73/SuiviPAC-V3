export type FieldKey =
  | 'temp'
  | 'pac_conso'
  | 'pac_prod'
  | 'cop_aff'
  | 'edf_kwh'
  | 'edf_eur'
  | 'gaz_kwh'
  | 'remarque';

export interface DayEntry {
  temp: number | null;
  pac_conso: number | null;
  pac_prod: number | null;
  cop_aff: number | null;
  edf_kwh: number | null;
  edf_eur: number | null;
  gaz_kwh: number | null;
  remarque: string | null;
}

export type EntriesMap = Record<string, DayEntry>;

export interface Params {
  pe: number;          // Prix électricité (€/kWh)
  abo: number;         // Abonnement électricité (€/j)
  pg: number;          // Prix gaz (€/kWh)
  abg: number;         // Abonnement gaz (€/j)
  rend: number;        // Rendement chaudière gaz
  fen: number;         // Fenêtre ± jours
  tol: number;         // Tolérance "Dans la moyenne" (ex: 0.10)
  tolt: number;        // Tolérance température (°C)
  cop_cible: number;   // COP cible
  cop_plancher: number;// COP plancher
  start: string;       // ISO YYYY-MM-DD
  obj_pct: number;     // Objectif économies % (ex: 0.35)
  obj_eur: number;     // Objectif économies € (ex: 700)
}

export interface YearN1 {
  labels: string[]; // 12 mois oct..sept
  gaz: (number | null)[];
  elec: (number | null)[];
}

export interface ReferenceData {
  params: Params;
  enedis: Record<string, number>;   // ISO date -> kWh
  gaz: Record<string, number>;      // ISO date -> kWh
  meteo: Record<string, number>;    // ISO date -> °C
  n1_total: Record<string, number>; // ISO date -> €
  year_n1: YearN1 | null;
  excelFileName?: string | null;
  importedAt?: string | null;
}

export type VerdictType =
  | 'Moins cher que d\'habitude'
  | 'Plus cher que d\'habitude'
  | 'Dans la moyenne'
  | '';

export interface ComputedDay {
  date: string; // ISO YYYY-MM-DD
  entry: DayEntry;
  depense: number | null;
  total: number | null;
  cop: number | null;
  hors_pac: number | null;
  refs: [number | null, number | null, number | null];
  ref_n1: number | null;
  ref_mean: number | null;
  elec_ref_kwh: number | null;
  temp_ref: number | null;
  eco_n1: number | null;
  benef_n1: number | null;
  eco_mean: number | null;
  benef_mean: number | null;
  verdict: VerdictType;
  cumul: number | null;
}

export interface MonthlySummary {
  label: string;
  y: number;
  m: number;
  jours: number;
  jours_mois: number;
  partiel: boolean;
  ref_n1_full: number | null;
  reel: number;
  total: number;
  ref_n1: number | null;
  ref_mean: number | null;
  eco: number | null;
  pct_n1: number | null;
  cop: number | null;
}

export interface TrajectoryPoint {
  date: string; // ISO YYYY-MM-DD
  n1: number;
  obj: number;
  reel: number | null;
}

export interface KPI {
  jours: number;
  hy0: string;
  hy1: string;
  eco_cumul: number | null;
  eco_mois: number | null;
  eco_jour: number | null;
  benef_cumul: number | null;
  benef_mois: number | null;
  benef_jour: number | null;
  obj_eur: number;
  obj_pct: number;
  cop_moyen: number | null;
  cop_rentab: number;
  cop_cible: number;
  mois: MonthlySummary | null;
}

export interface PacModel {
  days: ComputedDay[];
  hy_days: ComputedDay[];
  months: MonthlySummary[];
  kpi: KPI;
  last: ComputedDay | null;
  params: Params;
  year_n1: YearN1 | null;
  traj: TrajectoryPoint[];
}

export interface PublishConfig {
  github_user: string;
  github_repo: string;
  github_token: string;
  github_password: string;
  github_branch: string;
}

export type GoalPeriod = 'monthly' | 'annual';
export type GoalMetric = 'pac_kwh' | 'edf_kwh' | 'edf_eur';

export interface ConsumptionGoals {
  monthly: {
    pac_kwh: number;
    edf_kwh: number;
    edf_eur: number;
    byMonth: Record<string, Partial<Record<GoalMetric, number>>>;
  };
  annual: {
    pac_kwh: number;
    edf_kwh: number;
    edf_eur: number;
  };
}

export type ThemeMode = 'light' | 'medium' | 'dark';



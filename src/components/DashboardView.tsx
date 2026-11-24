import React, { useMemo, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  Check,
  FileSpreadsheet,
  Target,
  Thermometer,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import {
  ConsumptionGoals,
  GoalMetric,
  GoalPeriod,
  PacModel,
  ReferenceData,
} from '../types/pac';
import {
  analyzePeriodBudget,
  daysInMonth,
  diffDaysIso,
  fmtDateFr,
  frNum,
  hasN1References,
  parseFrFloat,
} from '../lib/pacEngine';
import {
  ConsumptionGauge,
  CopChart,
  CumulativeSavingsChart,
  CumulativeSpendChart,
  DailySpendChart,
  HeatingYearChart,
  MonthlySavingsChart,
} from './Charts';

interface DashboardViewProps {
  model: PacModel;
  reference: ReferenceData;
  consumptionGoals: ConsumptionGoals;
  onUpdateConsumptionGoals: (goals: ConsumptionGoals) => void;
  onGoToImport: () => void;
  readOnly?: boolean;
}

const METRIC_META: Record<
  GoalMetric,
  { label: string; short: string; unit: string }
> = {
  pac_kwh: { label: 'PAC consommée', short: 'PAC (kWh)', unit: 'kWh' },
  edf_kwh: { label: 'EDF total maison', short: 'EDF total (kWh)', unit: 'kWh' },
  edf_eur: { label: 'Dépense EDF', short: 'Dépense (€)', unit: '€' },
};

export function DashboardView({
  model,
  reference,
  consumptionGoals,
  onUpdateConsumptionGoals,
  onGoToImport,
  readOnly = false,
}: DashboardViewProps) {
  const k = model.kpi;
  const last = model.last;
  const n1Ready = hasN1References(reference);

  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>('monthly');
  const [goalMetric, setGoalMetric] = useState<GoalMetric>('edf_eur');

  const monthOptions = useMemo(() => {
    const map = new Map<string, { ym: string; label: string; y: number; m: number }>();
    for (const d of model.days) {
      const ym = d.date.slice(0, 7);
      if (!map.has(ym)) {
        const [yStr, mStr] = ym.split('-');
        map.set(ym, {
          ym,
          label: `${mStr}/${yStr}`,
          y: Number(yStr),
          m: Number(mStr),
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  }, [model.days]);

  const [selectedYm, setSelectedYm] = useState<string>(() =>
    monthOptions.length ? monthOptions[0].ym : '2026-11'
  );

  React.useEffect(() => {
    if (monthOptions.length && !monthOptions.some((o) => o.ym === selectedYm)) {
      setSelectedYm(monthOptions[0].ym);
    }
  }, [monthOptions, selectedYm]);

  const getTarget = (period: GoalPeriod, metric: GoalMetric, ym: string): number => {
    if (period === 'annual') return consumptionGoals.annual[metric];
    const override = consumptionGoals.monthly.byMonth?.[ym]?.[metric];
    return override !== undefined ? override : consumptionGoals.monthly[metric];
  };

  const [applyToMonthOnly, setApplyToMonthOnly] = useState(true);
  const [targetInput, setTargetInput] = useState<string>(() =>
    String(getTarget('monthly', 'edf_eur', selectedYm)).replace('.', ',')
  );
  const [goalSavedMsg, setGoalSavedMsg] = useState<string | null>(null);

  React.useEffect(() => {
    const cur = getTarget(goalPeriod, goalMetric, selectedYm);
    setTargetInput(String(cur).replace('.', ','));
  }, [goalPeriod, goalMetric, selectedYm, consumptionGoals]);

  const budgetAnalysis = useMemo(
    () => analyzePeriodBudget(model, reference, goalPeriod, selectedYm),
    [model, reference, goalPeriod, selectedYm]
  );

  const periodStats = useMemo(() => {
    const scopeDays =
      goalPeriod === 'annual'
        ? model.days.filter((d) => d.date >= k.hy0 && d.date <= k.hy1)
        : model.days.filter((d) => d.date.startsWith(selectedYm));

    const pacKwh = scopeDays.reduce((s, d) => s + (d.entry.pac_conso || 0), 0);
    const edfKwh = scopeDays.reduce((s, d) => s + (d.entry.edf_kwh || 0), 0);
    const edfEur = scopeDays.reduce((s, d) => s + (d.depense || 0), 0);

    const pacDays = scopeDays.filter((d) => d.entry.pac_conso !== null).length;
    const edfDays = scopeDays.filter((d) => d.entry.edf_kwh !== null).length;
    const eurDays = scopeDays.filter((d) => d.depense !== null).length;

    let totalPeriodDays = 365;
    if (goalPeriod === 'annual') {
      totalPeriodDays = diffDaysIso(k.hy0, k.hy1) + 1;
    } else {
      const [yStr, mStr] = selectedYm.split('-');
      const y = Number(yStr);
      const m = Number(mStr);
      if (y && m) totalPeriodDays = daysInMonth(y, m);
    }

    const periodLabel =
      goalPeriod === 'annual'
        ? `${fmtDateFr(k.hy0)} – ${fmtDateFr(k.hy1)}`
        : monthOptions.find((o) => o.ym === selectedYm)?.label || selectedYm;

    return {
      pac_kwh: { actual: pacKwh, days: pacDays },
      edf_kwh: { actual: edfKwh, days: edfDays },
      edf_eur: { actual: edfEur, days: eurDays },
      totalPeriodDays,
      periodLabel,
    };
  }, [goalPeriod, selectedYm, model.days, k.hy0, k.hy1, monthOptions]);

  const activeTarget = getTarget(goalPeriod, goalMetric, selectedYm);
  const activeActual = periodStats[goalMetric].actual;
  const activeDays = periodStats[goalMetric].days;

  const saveTargetValue = (val: number) => {
    if (!Number.isFinite(val) || val <= 0) return;

    if (goalPeriod === 'annual') {
      onUpdateConsumptionGoals({
        ...consumptionGoals,
        annual: {
          ...consumptionGoals.annual,
          [goalMetric]: val,
        },
      });
    } else if (applyToMonthOnly) {
      onUpdateConsumptionGoals({
        ...consumptionGoals,
        monthly: {
          ...consumptionGoals.monthly,
          byMonth: {
            ...(consumptionGoals.monthly.byMonth || {}),
            [selectedYm]: {
              ...(consumptionGoals.monthly.byMonth?.[selectedYm] || {}),
              [goalMetric]: val,
            },
          },
        },
      });
    } else {
      const nextByMonth = { ...(consumptionGoals.monthly.byMonth || {}) };
      if (nextByMonth[selectedYm]) {
        const copy = { ...nextByMonth[selectedYm] };
        delete copy[goalMetric];
        nextByMonth[selectedYm] = copy;
      }
      onUpdateConsumptionGoals({
        ...consumptionGoals,
        monthly: {
          ...consumptionGoals.monthly,
          [goalMetric]: val,
          byMonth: nextByMonth,
        },
      });
    }

    setGoalSavedMsg('Objectif mis à jour');
    window.setTimeout(() => setGoalSavedMsg(null), 2500);
  };

  const handleSaveGoal = (ev: React.FormEvent) => {
    ev.preventDefault();
    const parsed = parseFrFloat(targetInput);
    if (parsed === null || parsed <= 0) return;
    saveTargetValue(parsed);
  };

  const totalSpend = React.useMemo(
    () => model.hy_days.reduce((s, r) => s + (r.depense || 0), 0),
    [model.hy_days]
  );

  const totalPacKwh = React.useMemo(
    () => model.hy_days.reduce((s, r) => s + (r.entry.pac_conso || 0), 0),
    [model.hy_days]
  );

  const totalPacProd = React.useMemo(
    () => model.hy_days.reduce((s, r) => s + (r.entry.pac_prod || 0), 0),
    [model.hy_days]
  );

  const monthClimateStats = React.useMemo(() => {
    const map = new Map<string, { avgTemp: number | null; deltaTemp: number | null }>();
    for (const m of model.months) {
      const ym = `${m.y}-${String(m.m).padStart(2, '0')}`;
      const mDays = model.hy_days.filter((d) => d.date.startsWith(ym));
      const temps = mDays
        .map((d) => d.entry.temp)
        .filter((x): x is number => x !== null);
      const pairs = mDays.filter(
        (d) => d.entry.temp !== null && d.temp_ref !== null
      );
      const avgTemp = temps.length
        ? temps.reduce((s, x) => s + x, 0) / temps.length
        : null;
      const deltaTemp = pairs.length
        ? pairs.reduce((s, d) => s + (d.entry.temp! - d.temp_ref!), 0) / pairs.length
        : null;
      map.set(m.label, { avgTemp, deltaTemp });
    }
    return map;
  }, [model.months, model.hy_days]);

  const seasonTotals = React.useMemo(() => {
    const jours = model.months.reduce((s, m) => s + m.jours, 0);
    const reel = model.months.reduce((s, m) => s + m.reel, 0);
    const n1Eligible = model.months.filter((m) => m.ref_n1 !== null);
    const refN1 = n1Eligible.length
      ? n1Eligible.reduce((s, m) => s + (m.ref_n1 || 0), 0)
      : null;
    const meanEligible = model.months.filter((m) => m.ref_mean !== null);
    const refMean = meanEligible.length
      ? meanEligible.reduce((s, m) => s + (m.ref_mean || 0), 0)
      : null;
    const eco =
      n1Eligible.length
        ? n1Eligible.reduce((s, m) => s + (m.eco || 0), 0)
        : null;
    const pctN1 =
      refN1 && eco !== null ? eco / refN1 : null;
    return { jours, reel, refN1, refMean, eco, pctN1 };
  }, [model.months]);

  const ecoProgress =
    k.eco_cumul !== null && k.obj_eur > 0
      ? Math.max(0, Math.min(100, (k.eco_cumul / k.obj_eur) * 100))
      : 0;

  const benProgress =
    k.benef_cumul !== null && k.obj_pct > 0
      ? Math.max(0, Math.min(100, (k.benef_cumul / k.obj_pct) * 100))
      : 0;

  return (
    <MotionConfig reducedMotion="user">
    <div className="space-y-6">
      {!n1Ready && (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-3.5">
          <div className="text-sm text-amber-950">
            <span className="font-semibold">Références N-1 non chargées :</span>{' '}
            {readOnly
              ? 'les économies comparées (N-1 / N-2 / N-3) apparaîtront dès l’import depuis le poste PC.'
              : 'les économies comparées (N-1 / N-2 / N-3) s’afficheront dès l’import de votre fichier Suivi_PAC.xlsx ou après saisie des factures N-1.'}
          </div>
          {!readOnly && (
            <button
              type="button"
              onClick={onGoToImport}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" />
              Importer Excel / Configurer N-1
            </button>
          )}
        </div>
      )}

      {/* 4 cartes KPI en ligne */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="text-xs font-medium text-slate-500">
            Économie cumulée vs N-1
          </div>
          <div
            className={`mt-1.5 font-display text-2xl font-bold font-mono-num ${
              k.eco_cumul === null
                ? 'text-slate-900'
                : k.eco_cumul >= 0
                ? 'text-emerald-700'
                : 'text-red-700'
            }`}
          >
            {k.eco_cumul !== null ? `${frNum(k.eco_cumul, 0, true)} €` : `${frNum(totalSpend, 0)} € EDF`}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-600 font-mono-num">
            <span>Mois : {k.eco_mois !== null ? `${frNum(k.eco_mois, 0, true)} €` : '–'}</span>
            <span>·</span>
            <span>Jour : {k.eco_jour !== null ? `${frNum(k.eco_jour, 2, true)} €` : '–'}</span>
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <motion.div
              className="h-full bg-emerald-600 origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: ecoProgress / 100 }}
              transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-num">
            Objectif {frNum(k.obj_eur, 0)} € ({frNum(ecoProgress, 0)} %)
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="text-xs font-medium text-slate-500">
            Bénéfice vs N-1
          </div>
          <div
            className={`mt-1.5 font-display text-2xl font-bold font-mono-num ${
              k.benef_cumul === null
                ? 'text-slate-900'
                : k.benef_cumul >= 0
                ? 'text-emerald-700'
                : 'text-red-700'
            }`}
          >
            {k.benef_cumul !== null ? `${frNum(k.benef_cumul * 100, 0, true)} %` : '–'}
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-slate-600 font-mono-num">
            <span>
              Mois : {k.benef_mois !== null ? `${frNum(k.benef_mois * 100, 0, true)} %` : '–'}
            </span>
            <span>·</span>
            <span>
              Jour : {k.benef_jour !== null ? `${frNum(k.benef_jour * 100, 0, true)} %` : '–'}
            </span>
          </div>
          <div className="mt-3 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
            <motion.div
              className="h-full bg-teal-700 origin-left"
              initial={{ scaleX: 0 }}
              animate={{ scaleX: benProgress / 100 }}
              transition={{ duration: 0.4, delay: 0.04, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500 font-mono-num">
            Objectif -{frNum(k.obj_pct * 100, 0)} % ({frNum(benProgress, 0)} %)
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="text-xs font-medium text-slate-500">
            Dernier jour saisi
          </div>
          <div className="mt-1.5 font-display text-xl font-bold text-slate-900 font-mono-num">
            {last ? fmtDateFr(last.date) : '–'}
          </div>
          <div className="mt-1.5 text-xs text-slate-600">
            {last?.verdict ? (
              <span
                className={`inline-flex items-center gap-1 font-medium ${
                  last.verdict.startsWith('Moins')
                    ? 'text-emerald-700'
                    : last.verdict.startsWith('Plus')
                    ? 'text-red-700'
                    : 'text-amber-700'
                }`}
              >
                {last.verdict.startsWith('Moins') ? (
                  <TrendingDown className="h-3.5 w-3.5" />
                ) : last.verdict.startsWith('Plus') ? (
                  <TrendingUp className="h-3.5 w-3.5" />
                ) : null}
                {last.verdict}
              </span>
            ) : (
              <span className="font-mono-num">
                EDF : {last ? `${frNum(last.depense, 2)} €` : '–'} · COP : {last ? frNum(last.cop, 2) : '–'}
              </span>
            )}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-500 font-mono-num">
            {last?.entry.temp !== null && last?.entry.temp !== undefined
              ? `Temp. ${frNum(last.entry.temp, 1)} °C`
              : 'Temp. –'}{' '}
            · PAC {last?.entry.pac_conso !== null ? `${frNum(last?.entry.pac_conso, 1)} kWh` : '–'}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.24, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <div className="text-xs font-medium text-slate-500">
            Année de chauffage & COP moyen
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="font-display text-2xl font-bold font-mono-num text-slate-900">
              {frNum(k.cop_moyen, 2)}
            </span>
            <span className="text-xs text-slate-500">COP moyen réel</span>
          </div>
          <div className="mt-2 text-xs text-slate-600 font-mono-num">
            {k.jours} jours · {fmtDateFr(k.hy0)} → {fmtDateFr(k.hy1)}
          </div>
          <div className="mt-3 pt-2.5 border-t border-slate-100 text-xs text-slate-500 font-mono-num">
            PAC : {frNum(totalPacKwh, 0)} kWh élec → {frNum(totalPacProd, 0)} kWh chaud
          </div>
        </motion.div>
      </div>

      {/* Objectifs de consommation mensuelle / annuelle + Gauge Chart */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-4 pb-5 border-b border-slate-100">
          <div>
            <h3 className="font-display text-base font-semibold text-slate-900 flex items-center gap-2">
              <Target className="h-4 w-4 text-teal-700 shrink-0" />
              Budget € &amp; objectifs par période
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Suivi prioritaire en € (comparé à N-1 sur les mêmes jours), avec extrapolation et correction météo.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setGoalPeriod('monthly')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  goalPeriod === 'monthly'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Mensuel
              </button>
              <button
                type="button"
                onClick={() => setGoalPeriod('annual')}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  goalPeriod === 'annual'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Annuel
              </button>
            </div>

            {goalPeriod === 'monthly' && monthOptions.length > 0 && (
              <select
                value={selectedYm}
                onChange={(ev) => setSelectedYm(ev.target.value)}
                aria-label="Mois de référence"
                className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num font-medium text-slate-800 focus:border-teal-700 focus:outline-none"
              >
                {monthOptions.map((o) => (
                  <option key={o.ym} value={o.ym}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(['edf_eur', 'edf_kwh', 'pac_kwh'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setGoalMetric(m)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    goalMetric === m
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {METRIC_META[m].short}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Jauge de progression + résumé extrapolation */}
          <div className="lg:col-span-6 space-y-4">
            <ConsumptionGauge
              actual={activeActual}
              target={activeTarget}
              unit={METRIC_META[goalMetric].unit}
              label={METRIC_META[goalMetric].label}
              periodLabel={periodStats.periodLabel}
              daysCount={activeDays}
              totalPeriodDays={periodStats.totalPeriodDays}
              projectedOverride={
                goalMetric === 'edf_eur' ? budgetAnalysis.projectedEur : undefined
              }
              projectionLabel={
                goalMetric === 'edf_eur'
                  ? budgetAnalysis.projectionMethod === 'meteo'
                    ? 'Proj. météo'
                    : budgetAnalysis.projectionMethod === 'saison_n1'
                    ? 'Proj. saison N-1'
                    : 'Proj. prorata'
                  : undefined
              }
            />

            {goalMetric === 'edf_eur' && budgetAnalysis.projectionHint && (
              <div className="rounded-lg border border-slate-200/80 bg-slate-50/80 px-3.5 py-2.5 text-xs text-slate-600">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-slate-800">
                    Extrapolation ({budgetAnalysis.daysEnteredEur}/{budgetAnalysis.totalPeriodDays} j saisis)
                  </span>
                  {budgetAnalysis.n1FullPeriodEur !== null && (
                    <span className="font-mono-num text-slate-600">
                      N-1 période complète : <strong className="text-slate-900">{frNum(budgetAnalysis.n1FullPeriodEur, 0)} €</strong>
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {budgetAnalysis.projectionHint}
                </p>
              </div>
            )}
          </div>

          {/* Réglage du budget + comparatif N-1 & météo + aperçu des 3 indicateurs */}
          <div className="lg:col-span-6 lg:border-l lg:border-slate-100 lg:pl-8 space-y-5">
            {readOnly ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5 text-xs">
                <span className="font-medium text-slate-700">
                  Plafond {goalPeriod === 'monthly' ? 'mensuel' : 'annuel'} ·{' '}
                  {METRIC_META[goalMetric].label}
                </span>
                <span className="font-mono-num font-bold text-slate-900">
                  {frNum(activeTarget, 0)} {METRIC_META[goalMetric].unit}
                </span>
              </div>
            ) : (
              <form onSubmit={handleSaveGoal} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor="goal-target-input"
                    className="text-xs font-semibold text-slate-700"
                  >
                    Plafond {goalPeriod === 'monthly' ? 'mensuel' : 'annuel'} ·{' '}
                    {METRIC_META[goalMetric].label}
                  </label>
                  {goalSavedMsg && (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                      <Check className="h-3.5 w-3.5" />
                      {goalSavedMsg}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      id="goal-target-input"
                      type="text"
                      inputMode="decimal"
                      value={targetInput}
                      onChange={(ev) => setTargetInput(ev.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-12 text-sm font-mono-num font-semibold text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-500">
                      {METRIC_META[goalMetric].unit}
                    </span>
                  </div>
                  <button
                    type="submit"
                    className="h-10 rounded-lg bg-teal-700 px-4 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
                  >
                    Définir
                  </button>
                </div>

                {goalMetric === 'edf_eur' && budgetAnalysis.recommendedBudgetEur !== null && (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="text-slate-500 font-mono-num">
                      Repère N-1 −{frNum(k.obj_pct * 100, 0)} % :{' '}
                      <strong className="text-slate-800">
                        {frNum(budgetAnalysis.recommendedBudgetEur, 0)} €
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const rec = budgetAnalysis.recommendedBudgetEur!;
                        setTargetInput(String(rec));
                        saveTargetValue(rec);
                      }}
                      className="font-medium text-teal-700 hover:text-teal-800 underline underline-offset-2"
                    >
                      Appliquer ce plafond
                    </button>
                  </div>
                )}

                {goalPeriod === 'monthly' && (
                  <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={applyToMonthOnly}
                      onChange={(ev) => setApplyToMonthOnly(ev.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    Appliquer uniquement à {periodStats.periodLabel} (sinon objectif mensuel par défaut)
                  </label>
                )}
              </form>
            )}

            {/* Comparaison € N-1 & Correction climatique */}
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                  <Thermometer className="h-3.5 w-3.5 text-teal-700 shrink-0" />
                  Comparaison € &amp; effet température ({periodStats.periodLabel})
                </span>
                {budgetAnalysis.deltaTemp !== null && (
                  <span
                    className={`text-[11px] font-semibold font-mono-num ${
                      budgetAnalysis.deltaTemp >= 0 ? 'text-amber-700' : 'text-sky-700'
                    }`}
                  >
                    {frNum(budgetAnalysis.deltaTemp, 1, true)} °C{' '}
                    {budgetAnalysis.deltaTemp >= 0 ? 'plus doux' : 'plus froid'}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="rounded-md bg-white border border-slate-200/80 px-3 py-2.5">
                  <div className="text-[11px] text-slate-500">
                    Payé réel vs N-1 (mêmes jours)
                  </div>
                  {budgetAnalysis.n1SameDaysEur !== null ? (
                    <>
                      <div className="mt-1 font-mono-num font-semibold text-slate-900">
                        {frNum(budgetAnalysis.n1SameDaysMatchedActualEur, 2)} €{' '}
                        <span className="font-normal text-slate-400">vs</span>{' '}
                        {frNum(budgetAnalysis.n1SameDaysEur, 2)} €
                      </div>
                      <div
                        className={`mt-0.5 text-[11px] font-mono-num font-medium ${
                          (budgetAnalysis.savingsSameDaysEur ?? 0) >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        Éco. brute : {frNum(budgetAnalysis.savingsSameDaysEur, 2, true)} € (
                        {budgetAnalysis.savingsSameDaysPct !== null
                          ? `${frNum(budgetAnalysis.savingsSameDaysPct * 100, 0, true)} %`
                          : '–'}
                        )
                      </div>
                    </>
                  ) : (
                    <div className="mt-1 text-slate-500 font-mono-num">
                      {frNum(budgetAnalysis.actualEur, 2)} € saisis (N-1 non importé)
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-white border border-slate-200/80 px-3 py-2.5">
                  <div className="text-[11px] text-slate-500">
                    Températures &amp; correction DJU
                  </div>
                  {budgetAnalysis.avgTempActual !== null ? (
                    <>
                      <div className="mt-1 font-mono-num font-semibold text-slate-900">
                        {frNum(budgetAnalysis.avgTempActual, 1)} °C
                        {budgetAnalysis.avgTempRef !== null && (
                          <span className="font-normal text-slate-500">
                            {' '}
                            (N-1 : {frNum(budgetAnalysis.avgTempRef, 1)} °C)
                          </span>
                        )}
                      </div>
                      {budgetAnalysis.climateNormalizedEur !== null ? (
                        <div className="mt-0.5 text-[11px] font-mono-num text-slate-700">
                          À météo N-1 :{' '}
                          <strong className="text-slate-900">
                            {frNum(budgetAnalysis.climateNormalizedEur, 0)} €
                          </strong>
                          {budgetAnalysis.climateNormalizedSavingsPct !== null && (
                            <span
                              className={
                                budgetAnalysis.climateNormalizedSavingsPct >= 0
                                  ? ' text-emerald-700 font-medium'
                                  : ' text-red-700 font-medium'
                              }
                            >
                              {' '}
                              ({frNum(budgetAnalysis.climateNormalizedSavingsPct * 100, 0, true)} % vs N-1)
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-[11px] text-slate-500">
                          Importez la météo N-1 pour normaliser à climat égal.
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-1 text-slate-500">
                      Aucune température saisie sur la période.
                    </div>
                  )}
                </div>
              </div>

              {budgetAnalysis.thermalModel && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-slate-500 font-mono-num">
                  <span>
                    Modèle maison+PAC : {frNum(budgetAnalysis.thermalModel.baseEurPerDay, 2)} €/j fixe +{' '}
                    {frNum(budgetAnalysis.thermalModel.slopeEurPerDju, 2)} €/DJU (base 18 °C)
                  </span>
                  {(budgetAnalysis.thermalModel.copMild !== null ||
                    budgetAnalysis.thermalModel.copCool !== null) && (
                    <span>
                      COP :{' '}
                      {budgetAnalysis.thermalModel.copMild !== null
                        ? `${frNum(budgetAnalysis.thermalModel.copMild, 2)} (≥12°C)`
                        : '–'}{' '}
                      ·{' '}
                      {budgetAnalysis.thermalModel.copCool !== null
                        ? `${frNum(budgetAnalysis.thermalModel.copCool, 2)} (<12°C)`
                        : '–'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Vue rapide des 3 métriques sur la période */}
            <div className="pt-2 border-t border-slate-100 space-y-2.5">
              <div className="text-xs font-medium text-slate-500">
                Vue d’ensemble ({periodStats.periodLabel})
              </div>
              {(['edf_eur', 'edf_kwh', 'pac_kwh'] as const).map((m) => {
                const meta = METRIC_META[m];
                const act = periodStats[m].actual;
                const tgt = getTarget(goalPeriod, m, selectedYm);
                const ratio = tgt > 0 ? act / tgt : 0;
                const pct = Math.min(100, Math.max(0, ratio * 100));
                const barColor =
                  ratio > 1
                    ? 'bg-red-600'
                    : ratio >= 0.8
                    ? 'bg-amber-500'
                    : 'bg-emerald-600';
                const isSelected = goalMetric === m;

                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setGoalMetric(m)}
                    className={`w-full text-left rounded-lg px-3 py-2 transition-colors ${
                      isSelected ? 'bg-slate-100/90' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className={`font-medium ${isSelected ? 'text-slate-900' : 'text-slate-700'}`}>
                        {meta.label}
                      </span>
                      <span className="font-mono-num text-slate-700">
                        <strong className="text-slate-900">
                          {frNum(act, m === 'edf_eur' ? 2 : 0)}
                        </strong>{' '}
                        / {frNum(tgt, 0)} {meta.unit}{' '}
                        <span className="text-slate-500">({frNum(ratio * 100, 0)} %)</span>
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                      <motion.div
                        className={`h-full origin-left ${barColor}`}
                        initial={{ scaleX: 0 }}
                        animate={{ scaleX: pct / 100 }}
                        transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </motion.section>

      {/* Grille des 6 graphiques */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.06, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            1. Dépense de chauffage cumulée sur l’année (€)
          </h3>
          <CumulativeSpendChart model={model} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            2. Économie cumulée vs N-1 (€)
          </h3>
          <CumulativeSavingsChart model={model} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.14, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            3. Économie par mois vs N-1 (€) : mêmes jours
          </h3>
          <MonthlySavingsChart model={model} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            4. Année de chauffage : N-1 gaz, élec et PAC (€)
          </h3>
          <HeatingYearChart model={model} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.22, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            5. Dépense du jour (EDF) vs N-1 et objectif (€)
          </h3>
          <DailySpendChart model={model} />
        </motion.section>

        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.28, delay: 0.26, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-xl border border-slate-200 bg-white p-5"
        >
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-3">
            6. COP réel du jour et seuils de performance
          </h3>
          <CopChart model={model} />
        </motion.section>
      </div>

      {/* Tableau récapitulatif mensuel */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, delay: 0.28, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-xl border border-slate-200 bg-white overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-slate-900">
            Synthèse mensuelle ({fmtDateFr(k.hy0)} – {fmtDateFr(k.hy1)})
          </h3>
          <span className="text-xs text-slate-500">
            {model.months.length} mois
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="px-5 py-2.5 text-left">Mois</th>
                <th className="px-4 py-2.5 text-right">Jours</th>
                <th className="px-4 py-2.5 text-right">T° moy.</th>
                <th className="px-4 py-2.5 text-right">Dépense EDF</th>
                <th className="px-4 py-2.5 text-right">Réf. N-1</th>
                <th className="px-4 py-2.5 text-right">Réf. moy.</th>
                <th className="px-4 py-2.5 text-right">Économie</th>
                <th className="px-4 py-2.5 text-right">Bénéfice</th>
                <th className="px-5 py-2.5 text-right">COP moyen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {model.months.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-5 py-8 text-center text-slate-500">
                    Aucune donnée mensuelle disponible.
                  </td>
                </tr>
              ) : (
                model.months.map((m) => {
                  const clim = monthClimateStats.get(m.label);
                  return (
                    <tr key={m.label} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-2.5 font-medium text-slate-900">
                        {m.label}
                        {m.partiel && (
                          <span className="ml-2 text-xs font-normal text-slate-500 font-mono-num">
                            ({m.jours}/{m.jours_mois} j)
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                        {m.jours}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                        {clim?.avgTemp !== null && clim?.avgTemp !== undefined ? (
                          <span>
                            {frNum(clim.avgTemp, 1)} °C
                            {clim.deltaTemp !== null && (
                              <span
                                className={`ml-1 text-[11px] ${
                                  clim.deltaTemp >= 0 ? 'text-amber-700' : 'text-sky-700'
                                }`}
                              >
                                ({frNum(clim.deltaTemp, 1, true)})
                              </span>
                            )}
                          </span>
                        ) : (
                          '–'
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num font-medium text-slate-900">
                        {frNum(m.reel, 2)} €
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                        {m.ref_n1 !== null ? `${frNum(m.ref_n1, 2)} €` : '–'}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono-num text-slate-700">
                        {m.ref_mean !== null ? `${frNum(m.ref_mean, 2)} €` : '–'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono-num font-semibold ${
                          m.eco === null
                            ? 'text-slate-400'
                            : m.eco >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {m.eco !== null ? `${frNum(m.eco, 2, true)} €` : '–'}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-mono-num ${
                          m.pct_n1 === null
                            ? 'text-slate-400'
                            : m.pct_n1 >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {m.pct_n1 !== null ? `${frNum(m.pct_n1 * 100, 0, true)} %` : '–'}
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono-num font-medium text-slate-900">
                        {frNum(m.cop, 2)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {model.months.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50/90 font-semibold text-slate-900">
                  <td className="px-5 py-2.5">Total saison</td>
                  <td className="px-4 py-2.5 text-right font-mono-num">
                    {seasonTotals.jours}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono-num text-slate-500">
                    –
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono-num">
                    {frNum(seasonTotals.reel, 2)} €
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono-num">
                    {seasonTotals.refN1 !== null ? `${frNum(seasonTotals.refN1, 2)} €` : '–'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono-num">
                    {seasonTotals.refMean !== null ? `${frNum(seasonTotals.refMean, 2)} €` : '–'}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono-num ${
                      seasonTotals.eco === null
                        ? 'text-slate-400'
                        : seasonTotals.eco >= 0
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {seasonTotals.eco !== null ? `${frNum(seasonTotals.eco, 2, true)} €` : '–'}
                  </td>
                  <td
                    className={`px-4 py-2.5 text-right font-mono-num ${
                      seasonTotals.pctN1 === null
                        ? 'text-slate-400'
                        : seasonTotals.pctN1 >= 0
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {seasonTotals.pctN1 !== null
                      ? `${frNum(seasonTotals.pctN1 * 100, 0, true)} %`
                      : '–'}
                  </td>
                  <td className="px-5 py-2.5 text-right font-mono-num">
                    {frNum(k.cop_moyen, 2)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </motion.section>
    </div>
    </MotionConfig>
  );
}

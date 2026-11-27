import React, { useMemo, useState } from 'react';
import { motion, MotionConfig } from 'motion/react';
import {
  BarChart3,
  BatteryCharging,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Contrast,
  Copy,
  Eye,
  Home,
  LogOut,
  Maximize2,
  Minimize2,
  Moon,
  Search,
  Signal,
  Sun,
  Thermometer,
  TrendingDown,
  TrendingUp,
  Wifi,
} from 'lucide-react';
import { PWAInstallButton } from './PWAStatus';
import {
  ConsumptionGoals,
  GoalPeriod,
  PacModel,
  ReferenceData,
  ThemeMode,
} from '../types/pac';
import {
  analyzePeriodBudget,
  fmtDateFr,
  frNum,
  parseEcsCycles,
} from '../lib/pacEngine';
import {
  AnnualSavingsGauge,
  ConsumptionGauge,
  CopChart,
  CumulativeSavingsChart,
  CumulativeSpendChart,
  DailySpendChart,
  DayComparisonChart,
  HeatingYearChart,
  MonthlySavingsChart,
} from './Charts';
import { APP_VERSION } from '../lib/version';

type AndroidTab = 'apercu' | 'climat' | 'graphiques' | 'journal';

interface Android16ViewProps {
  model: PacModel;
  reference: ReferenceData;
  consumptionGoals: ConsumptionGoals;
  isMobileScreen: boolean;
  onSwitchMode?: (mode: 'pc' | 'web' | 'android') => void;
  userEmail?: string | null;
  cloudSynced?: boolean;
  onSignOut?: () => void;
  theme?: ThemeMode;
  onCycleTheme?: () => void;
}

export function Android16View({
  model,
  reference,
  consumptionGoals,
  isMobileScreen,
  onSwitchMode,
  userEmail,
  cloudSynced = false,
  onSignOut,
  theme = 'light',
  onCycleTheme,
}: Android16ViewProps) {
  const [androidTab, setAndroidTab] = useState<AndroidTab>('apercu');
  const [period, setPeriod] = useState<GoalPeriod>('monthly');
  const [fullScreenPreview, setFullScreenPreview] = useState(false);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [verdictFilter, setVerdictFilter] = useState<'all' | 'good' | 'bad'>('all');

  const k = model.kpi;
  const last = model.last;

  const validDays = useMemo(
    () => model.days.filter((d) => d.depense !== null),
    [model.days]
  );
  const [selectedDayDate, setSelectedDayDate] = useState<string | null>(null);

  const selectedDayIdx = useMemo(() => {
    if (!validDays.length) return -1;
    if (!selectedDayDate) return validDays.length - 1;
    const idx = validDays.findIndex((d) => d.date === selectedDayDate);
    return idx >= 0 ? idx : validDays.length - 1;
  }, [validDays, selectedDayDate]);

  const activeDay =
    (selectedDayIdx >= 0 ? validDays[selectedDayIdx] : null) ?? last;
  const totalEdfSpend = useMemo(
    () => model.hy_days.reduce((s, d) => s + (d.depense || 0), 0),
    [model.hy_days]
  );
  const activeDayEcs = parseEcsCycles(activeDay?.entry.remarque);

  const monthOptions = useMemo(() => {
    const map = new Map<string, { ym: string; label: string }>();
    for (const d of model.days) {
      const ym = d.date.slice(0, 7);
      if (!map.has(ym)) {
        map.set(ym, { ym, label: `${ym.slice(5, 7)}/${ym.slice(0, 4)}` });
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

  const budgetAnalysis = useMemo(
    () => analyzePeriodBudget(model, reference, period, selectedYm),
    [model, reference, period, selectedYm]
  );

  const euroTarget = useMemo(() => {
    if (period === 'annual') return consumptionGoals.annual.edf_eur;
    const override = consumptionGoals.monthly.byMonth?.[selectedYm]?.edf_eur;
    return override !== undefined ? override : consumptionGoals.monthly.edf_eur;
  }, [period, selectedYm, consumptionGoals]);

  const monthClimateStats = useMemo(() => {
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

  const filteredDays = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...model.days]
      .reverse()
      .filter((r) => {
        if (verdictFilter === 'good' && !r.verdict.startsWith('Moins')) return false;
        if (verdictFilter === 'bad' && !r.verdict.startsWith('Plus')) return false;
        if (q) {
          const fr = fmtDateFr(r.date).toLowerCase();
          const rem = (r.entry.remarque || '').toLowerCase();
          if (!fr.includes(q) && !r.date.includes(q) && !rem.includes(q)) return false;
        }
        return true;
      });
  }, [model.days, search, verdictFilter]);

  const copyShareUrl = async (targetMode: 'android' | 'web') => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', targetMode);
      await navigator.clipboard.writeText(url.toString());
      setCopiedLink(targetMode === 'android' ? 'Lien Android copié' : 'Lien Web copié');
      window.setTimeout(() => setCopiedLink(null), 2500);
    } catch {
      setCopiedLink('Copie impossible ici');
      window.setTimeout(() => setCopiedLink(null), 2500);
    }
  };

  const monthSpendEur = useMemo(() => {
    const curYm = last ? last.date.slice(0, 7) : selectedYm;
    return model.hy_days
      .filter((d) => d.date.startsWith(curYm))
      .reduce((s, d) => s + (d.depense || 0), 0);
  }, [model.hy_days, last, selectedYm]);

  const usePhoneFrame = !isMobileScreen && !fullScreenPreview;

  const phoneBody = (
    <div
      className={`flex flex-col bg-[#F3F6F6] text-slate-900 ${
        usePhoneFrame ? 'h-[736px] overflow-hidden' : 'min-h-screen'
      }`}
    >
      {/* Android 16 Status Bar (dans l'aperçu PC) */}
      {usePhoneFrame && (
        <div className="bg-[#0F766E] text-white px-5 pt-2.5 pb-1.5 flex items-center justify-between text-[11px] font-medium shrink-0 select-none">
          <span className="font-mono-num">11:26</span>
          <div className="h-3.5 w-3.5 rounded-full bg-slate-950/85 ring-1 ring-white/15" />
          <div className="flex items-center gap-1.5">
            <Signal className="h-3 w-3" />
            <Wifi className="h-3 w-3" />
            <BatteryCharging className="h-3.5 w-3.5" />
          </div>
        </div>
      )}

      {/* Material 3 / Android 16 Top App Bar */}
      <header className="bg-[#0F766E] text-white px-4 pt-2 pb-3.5 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[11px] text-teal-100/90 font-medium flex items-center gap-1.5">
              <span>Android 16 · Visualisation seule</span>
              {cloudSynced && (
                <span className="inline-flex items-center gap-1 text-emerald-200">
                  <Cloud className="h-3 w-3" />
                </span>
              )}
            </div>
            <h2 className="font-display text-lg font-bold tracking-tight truncate flex items-baseline gap-2">
              <span>Suivi PAC</span>
              <span className="text-xs font-mono-num font-semibold text-teal-100/90">
                {APP_VERSION}
              </span>
            </h2>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="text-right text-[11px] font-mono-num text-teal-50/90">
              <div>{k.jours} jours</div>
              <div>{last ? fmtDateFr(last.date) : '–'}</div>
            </div>
            {onCycleTheme && (
              <button
                type="button"
                onClick={onCycleTheme}
                title={`Thème : ${theme === 'light' ? 'Clair' : theme === 'medium' ? 'Médium' : 'Dark'}`}
                aria-label="Changer de thème"
                className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                {theme === 'light' ? (
                  <Sun className="h-4 w-4" />
                ) : theme === 'medium' ? (
                  <Contrast className="h-4 w-4" />
                ) : (
                  <Moon className="h-4 w-4" />
                )}
              </button>
            )}
            {isMobileScreen && onSignOut && (
              <button
                type="button"
                onClick={onSignOut}
                title={userEmail ? `Déconnecter (${userEmail})` : 'Déconnexion'}
                aria-label="Déconnexion"
                className="p-2 rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Scrollable Android Content */}
      <div
        className={`flex-1 overflow-y-auto px-3.5 py-4 space-y-3.5 ${
          usePhoneFrame ? 'pb-4' : 'pb-24'
        }`}
      >
        {androidTab === 'apercu' && (
          <motion.div
            key="apercu"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3.5"
          >
            {isMobileScreen && (
              <div className="flex items-center justify-between gap-2">
                {userEmail ? (
                  <span className="text-[11px] text-slate-500 truncate">
                    {userEmail}
                  </span>
                ) : (
                  <span />
                )}
                <PWAInstallButton compact />
              </div>
            )}
            {/* Hero Verdict du jour + 6 indicateurs */}
            <div className="rounded-3xl bg-white p-4 shadow-xs border border-slate-200/70">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span>Verdict du jour</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    disabled={selectedDayIdx <= 0}
                    onClick={() => {
                      const prev = validDays[Math.max(0, selectedDayIdx - 1)];
                      if (prev) setSelectedDayDate(prev.date);
                    }}
                    className="p-1 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-35 hover:bg-slate-50"
                    aria-label="Jour précédent"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="font-mono-num font-medium text-slate-700 px-1.5">
                    {activeDay ? fmtDateFr(activeDay.date) : '–'}
                  </span>
                  <button
                    type="button"
                    disabled={selectedDayIdx < 0 || selectedDayIdx >= validDays.length - 1}
                    onClick={() => {
                      const nextIdx = Math.min(validDays.length - 1, selectedDayIdx + 1);
                      if (nextIdx >= validDays.length - 1) {
                        setSelectedDayDate(null);
                      } else if (validDays[nextIdx]) {
                        setSelectedDayDate(validDays[nextIdx].date);
                      }
                    }}
                    className="p-1 rounded-lg border border-slate-200 text-slate-600 disabled:opacity-35 hover:bg-slate-50"
                    aria-label="Jour suivant"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                  {selectedDayDate !== null && selectedDayIdx < validDays.length - 1 && (
                    <button
                      type="button"
                      onClick={() => setSelectedDayDate(null)}
                      className="ml-0.5 rounded-lg border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-teal-700 hover:bg-slate-50"
                    >
                      Dernier
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-baseline justify-between gap-2">
                <div className="font-display text-3xl font-bold font-mono-num text-slate-900">
                  {activeDay?.depense !== null && activeDay?.depense !== undefined
                    ? `${frNum(activeDay.depense, 2)} €`
                    : '–'}
                </div>
                {activeDay?.ref_n1 !== null && activeDay?.ref_n1 !== undefined && (
                  <div className="text-xs text-slate-500 font-mono-num">
                    Réf. N-1 : {frNum(activeDay.ref_n1, 2)} €
                  </div>
                )}
              </div>

              {activeDay?.verdict && (
                <div
                  className={`mt-1.5 inline-flex items-center gap-1 text-xs font-semibold ${
                    activeDay.verdict.startsWith('Moins')
                      ? 'text-emerald-700'
                      : activeDay.verdict.startsWith('Plus')
                      ? 'text-red-700'
                      : 'text-amber-700'
                  }`}
                >
                  {activeDay.verdict.startsWith('Moins') ? (
                    <TrendingDown className="h-3.5 w-3.5" />
                  ) : activeDay.verdict.startsWith('Plus') ? (
                    <TrendingUp className="h-3.5 w-3.5" />
                  ) : null}
                  {activeDay.verdict}
                  {activeDay.eco_n1 !== null && (
                    <span className="font-mono-num ml-1">
                      ({frNum(-activeDay.eco_n1, 2, true)} €)
                    </span>
                  )}
                </div>
              )}

              <div className="mt-3 pt-2.5 border-t border-slate-100 grid grid-cols-3 gap-2.5 text-center">
                <div>
                  <div className="text-[10px] text-slate-500">COP réel</div>
                  <div className="text-xs font-semibold font-mono-num text-teal-800">
                    {activeDay ? frNum(activeDay.cop, 2) : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Élec hors PAC</div>
                  <div className="text-xs font-semibold font-mono-num text-slate-900">
                    {activeDay?.hors_pac !== null && activeDay?.hors_pac !== undefined
                      ? `${frNum(activeDay.hors_pac, 1)} kWh`
                      : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">T° ext.</div>
                  <div className="text-xs font-semibold font-mono-num text-slate-900">
                    {activeDay?.entry.temp !== null && activeDay?.entry.temp !== undefined
                      ? `${frNum(activeDay.entry.temp, 1)} °C`
                      : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">PAC élec</div>
                  <div className="text-xs font-semibold font-mono-num text-slate-900">
                    {activeDay?.entry.pac_conso !== null && activeDay?.entry.pac_conso !== undefined
                      ? `${frNum(activeDay.entry.pac_conso, 1)} kWh`
                      : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Écart N-1</div>
                  <div
                    className={`text-xs font-semibold font-mono-num ${
                      activeDay?.benef_n1 === null || activeDay?.benef_n1 === undefined
                        ? 'text-slate-400'
                        : activeDay.benef_n1 >= 0
                        ? 'text-emerald-700'
                        : 'text-red-700'
                    }`}
                  >
                    {activeDay?.benef_n1 !== null && activeDay?.benef_n1 !== undefined
                      ? `${frNum(-activeDay.benef_n1 * 100, 0, true)} %`
                      : '–'}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Remarque / ECS</div>
                  <div className="text-xs font-semibold text-slate-900 truncate">
                    {activeDayEcs ? `ECS ${activeDayEcs}` : activeDay?.entry.remarque || '–'}
                  </div>
                </div>
              </div>
            </div>

            {/* Graphique Aujourd’hui (EDF) vs références (€) */}
            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                Aujourd’hui (EDF) vs références (€)
              </div>
              <DayComparisonChart day={activeDay} model={model} />
            </div>

            {/* Objectif économies de l’année */}
            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-1 text-center">
                Objectif économies de l’année
              </div>
              <AnnualSavingsGauge
                value={model.kpi.eco_cumul}
                target={model.kpi.obj_eur}
                fallbackSpend={totalEdfSpend}
              />
            </div>

            {/* 2x2 Material 3 Tonal KPI Cards */}
            <div className="grid grid-cols-2 gap-2.5">
              <div className="rounded-2xl bg-[#E3F2EF] p-3.5">
                <div className="text-[11px] font-medium text-teal-900/75">
                  Économie saison
                </div>
                <div
                  className={`mt-1 font-display text-xl font-bold font-mono-num ${
                    k.eco_cumul !== null && k.eco_cumul < 0
                      ? 'text-red-700'
                      : 'text-teal-950'
                  }`}
                >
                  {k.eco_cumul !== null ? `${frNum(k.eco_cumul, 0, true)} €` : '–'}
                </div>
                <div className="mt-0.5 text-[11px] font-mono-num text-teal-900/70">
                  Obj. {frNum(k.obj_eur, 0)} €
                </div>
              </div>

              <div className="rounded-2xl bg-white p-3.5 border border-slate-200/70">
                <div className="text-[11px] font-medium text-slate-500">
                  Bénéfice vs N-1
                </div>
                <div
                  className={`mt-1 font-display text-xl font-bold font-mono-num ${
                    k.benef_cumul !== null && k.benef_cumul >= 0
                      ? 'text-emerald-700'
                      : 'text-slate-900'
                  }`}
                >
                  {k.benef_cumul !== null
                    ? `${frNum(k.benef_cumul * 100, 0, true)} %`
                    : '–'}
                </div>
                <div className="mt-0.5 text-[11px] font-mono-num text-slate-500">
                  Cible -{frNum(k.obj_pct * 100, 0)} %
                </div>
              </div>

              <div className="rounded-2xl bg-white p-3.5 border border-slate-200/70">
                <div className="text-[11px] font-medium text-slate-500">
                  Dépense mois en cours
                </div>
                <div className="mt-1 font-display text-xl font-bold font-mono-num text-slate-900">
                  {frNum(monthSpendEur, 0)} €
                </div>
                <div className="mt-0.5 text-[11px] font-mono-num text-slate-500">
                  Éco. {k.eco_mois !== null ? `${frNum(k.eco_mois, 0, true)} €` : '–'}
                </div>
              </div>

              <div className="rounded-2xl bg-white p-3.5 border border-slate-200/70">
                <div className="text-[11px] font-medium text-slate-500">
                  COP moyen réel
                </div>
                <div className="mt-1 font-display text-xl font-bold font-mono-num text-slate-900">
                  {frNum(k.cop_moyen, 2)}
                </div>
                <div className="mt-0.5 text-[11px] font-mono-num text-slate-500">
                  Rentab. {frNum(k.cop_rentab, 2)}
                </div>
              </div>
            </div>

            {/* Jauge Budget € */}
            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <ConsumptionGauge
                actual={budgetAnalysis.actualEur}
                target={euroTarget}
                unit="€"
                label="Budget EDF"
                periodLabel={budgetAnalysis.periodLabel}
                daysCount={budgetAnalysis.daysEnteredEur}
                totalPeriodDays={budgetAnalysis.totalPeriodDays}
                projectedOverride={budgetAnalysis.projectedEur}
                projectionLabel={
                  budgetAnalysis.projectionMethod === 'meteo'
                    ? 'Proj. météo'
                    : budgetAnalysis.projectionMethod === 'saison_n1'
                    ? 'Proj. saison'
                    : 'Proj. prorata'
                }
              />
            </div>
          </motion.div>
        )}

        {androidTab === 'climat' && (
          <motion.div
            key="climat"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3.5"
          >
            {/* Sélecteur période */}
            <div className="rounded-2xl bg-white p-3 border border-slate-200/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => setPeriod('monthly')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    period === 'monthly'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Mensuel
                </button>
                <button
                  type="button"
                  onClick={() => setPeriod('annual')}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                    period === 'annual'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600'
                  }`}
                >
                  Annuel
                </button>
              </div>
              {period === 'monthly' && monthOptions.length > 0 && (
                <select
                  value={selectedYm}
                  onChange={(ev) => setSelectedYm(ev.target.value)}
                  className="h-8 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-mono-num font-semibold text-slate-800"
                >
                  {monthOptions.map((o) => (
                    <option key={o.ym} value={o.ym}>
                      {o.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Effet température & extrapolation */}
            <div className="rounded-3xl bg-white p-4 border border-slate-200/70 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <Thermometer className="h-4 w-4 text-teal-700" />
                  Climat &amp; euros ({budgetAnalysis.periodLabel})
                </span>
                {budgetAnalysis.deltaTemp !== null && (
                  <span
                    className={`text-xs font-mono-num font-semibold ${
                      budgetAnalysis.deltaTemp >= 0 ? 'text-amber-700' : 'text-sky-700'
                    }`}
                  >
                    {frNum(budgetAnalysis.deltaTemp, 1, true)} °C
                  </span>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2.5 text-xs">
                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-[11px] text-slate-500">Payé réel</div>
                  <div className="mt-0.5 font-mono-num font-bold text-slate-900 text-sm">
                    {frNum(budgetAnalysis.actualEur, 2)} €
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono-num">
                    N-1 mêmes j. :{' '}
                    {budgetAnalysis.n1SameDaysEur !== null
                      ? `${frNum(budgetAnalysis.n1SameDaysEur, 0)} €`
                      : '–'}
                  </div>
                </div>

                <div className="rounded-2xl bg-slate-50 p-3">
                  <div className="text-[11px] text-slate-500">À météo N-1</div>
                  <div className="mt-0.5 font-mono-num font-bold text-slate-900 text-sm">
                    {budgetAnalysis.climateNormalizedEur !== null
                      ? `${frNum(budgetAnalysis.climateNormalizedEur, 0)} €`
                      : '–'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 font-mono-num">
                    T° moy. :{' '}
                    {budgetAnalysis.avgTempActual !== null
                      ? `${frNum(budgetAnalysis.avgTempActual, 1)} °C`
                      : '–'}
                  </div>
                </div>
              </div>

              {budgetAnalysis.projectedEur !== null && (
                <div className="rounded-2xl bg-[#E3F2EF] px-3.5 py-2.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-teal-950">
                    Projection fin de période
                  </span>
                  <span className="font-mono-num font-bold text-teal-950">
                    {frNum(budgetAnalysis.projectedEur, 0)} €
                  </span>
                </div>
              )}
            </div>

            {/* Cartes mensuelles en € */}
            <div className="space-y-2">
              <div className="px-1 text-xs font-semibold text-slate-600">
                Détail mois par mois
              </div>
              {model.months.map((m) => {
                const clim = monthClimateStats.get(m.label);
                return (
                  <div
                    key={m.label}
                    className="rounded-2xl bg-white p-3.5 border border-slate-200/70 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-semibold text-sm text-slate-900 font-mono-num">
                        {m.label}
                        {m.partiel && (
                          <span className="ml-1.5 text-[11px] font-normal text-slate-500">
                            ({m.jours}/{m.jours_mois} j)
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 font-mono-num">
                        {clim?.avgTemp !== null && clim?.avgTemp !== undefined
                          ? `${frNum(clim.avgTemp, 1)} °C`
                          : 'T° –'}{' '}
                        · COP {frNum(m.cop, 2)}
                      </div>
                    </div>
                    <div className="text-right font-mono-num">
                      <div className="text-sm font-bold text-slate-900">
                        {frNum(m.reel, 2)} €
                      </div>
                      <div
                        className={`text-[11px] font-medium ${
                          m.eco === null
                            ? 'text-slate-400'
                            : m.eco >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {m.eco !== null
                          ? `${frNum(m.eco, 0, true)} € (${frNum((m.pct_n1 || 0) * 100, 0, true)} %)`
                          : 'N-1 non importé'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {androidTab === 'graphiques' && (
          <motion.div
            key="graphiques"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3.5"
          >
            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                1. Dépense cumulée (€)
              </div>
              <CumulativeSpendChart model={model} />
            </div>

            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                2. Économie cumulée vs N-1 (€)
              </div>
              <CumulativeSavingsChart model={model} />
            </div>

            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                3. Économie par mois (€)
              </div>
              <MonthlySavingsChart model={model} />
            </div>

            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                4. Année N-1 vs PAC (€)
              </div>
              <HeatingYearChart model={model} />
            </div>

            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                5. Dépense du jour (€)
              </div>
              <DailySpendChart model={model} />
            </div>

            <div className="rounded-3xl bg-white p-4 border border-slate-200/70">
              <div className="text-xs font-semibold text-slate-900 mb-2">
                6. COP réel du jour
              </div>
              <CopChart model={model} />
            </div>
          </motion.div>
        )}

        {androidTab === 'journal' && (
          <motion.div
            key="journal"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="space-y-3"
          >
            <div className="rounded-2xl bg-white p-3 border border-slate-200/70 space-y-2.5">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  type="text"
                  value={search}
                  onChange={(ev) => setSearch(ev.target.value)}
                  placeholder="Rechercher une date ou remarque…"
                  className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1">
                {(
                  [
                    ['all', 'Tous'],
                    ['good', 'Économie'],
                    ['bad', 'Surcoût'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setVerdictFilter(id)}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-medium ${
                      verdictFilter === id
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              {filteredDays.slice(0, 60).map((r) => {
                const ecs = parseEcsCycles(r.entry.remarque);
                return (
                  <div
                    key={r.date}
                    className="rounded-2xl bg-white p-3.5 border border-slate-200/70 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-mono-num text-sm font-semibold text-slate-900">
                        {fmtDateFr(r.date)}
                      </div>
                      <div className="mt-0.5 text-[11px] text-slate-500 font-mono-num truncate">
                        {r.entry.temp !== null ? `${frNum(r.entry.temp, 1)} °C` : 'T° –'} · COP{' '}
                        {frNum(r.cop, 2)}
                        {ecs ? ` · ECS ${ecs}` : r.entry.remarque ? ` · ${r.entry.remarque}` : ''}
                      </div>
                    </div>
                    <div className="text-right font-mono-num shrink-0">
                      <div className="text-sm font-bold text-slate-900">
                        {r.depense !== null ? `${frNum(r.depense, 2)} €` : '–'}
                      </div>
                      <div
                        className={`text-[11px] font-medium ${
                          r.eco_n1 === null
                            ? 'text-slate-400'
                            : r.eco_n1 >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {r.eco_n1 !== null ? `${frNum(r.eco_n1, 2, true)} €` : '–'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </div>

      {/* Android 16 Material 3 Bottom Navigation Bar */}
      <nav
        className={`bg-white border-t border-slate-200/80 grid grid-cols-4 px-2 py-1.5 shrink-0 ${
          usePhoneFrame ? '' : 'fixed bottom-0 inset-x-0 z-30'
        }`}
      >
        {(
          [
            { id: 'apercu', label: 'Aperçu', icon: Home },
            { id: 'climat', label: 'Climat €', icon: Thermometer },
            { id: 'graphiques', label: 'Courbes', icon: BarChart3 },
            { id: 'journal', label: 'Journal', icon: CalendarDays },
          ] as const
        ).map((item) => {
          const Icon = item.icon;
          const active = androidTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setAndroidTab(item.id)}
              className="flex flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium"
            >
              <span
                className={`px-4 py-1 rounded-full transition-colors ${
                  active
                    ? 'bg-[#D6EFEA] text-[#0F766E]'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
              </span>
              <span className={active ? 'text-slate-900 font-semibold' : 'text-slate-500'}>
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Android 16 Gesture Pill */}
      {usePhoneFrame && (
        <div className="bg-white pb-2 pt-0.5 flex justify-center shrink-0">
          <div className="h-1 w-28 rounded-full bg-slate-300" />
        </div>
      )}
    </div>
  );

  return (
    <MotionConfig reducedMotion="user">
      {!usePhoneFrame ? (
        <div className="relative">
          {!isMobileScreen && fullScreenPreview && (
            <div className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between text-xs">
              <span>Aperçu plein écran Android 16 (lecture seule)</span>
              <button
                type="button"
                onClick={() => setFullScreenPreview(false)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-1 hover:bg-white/20 transition-colors"
              >
                <Minimize2 className="h-3.5 w-3.5" />
                Revenir au cadre smartphone
              </button>
            </div>
          )}
          {phoneBody}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Barre explicative des 3 cibles + actions rapides */}
          <div className="rounded-xl border border-slate-200 bg-white p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                <Eye className="h-4 w-4 text-teal-700" />
                Aperçu Android 16 (visualisation seule)
              </div>
              <p className="text-xs text-slate-500">
                Interface Material 3 tactile optimisée pour smartphone Android 16 : consultation rapide des euros, de la météo et des courbes sans risque de modification.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {copiedLink && (
                <span className="text-xs font-medium text-emerald-700 mr-1">
                  {copiedLink}
                </span>
              )}
              <button
                type="button"
                onClick={() => copyShareUrl('android')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                Copier lien Android (?mode=android)
              </button>
              <button
                type="button"
                onClick={() => copyShareUrl('web')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                <Copy className="h-3.5 w-3.5" />
                Copier lien Web (?mode=web)
              </button>
              <button
                type="button"
                onClick={() => setFullScreenPreview(true)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 transition-colors"
              >
                <Maximize2 className="h-3.5 w-3.5" />
                Plein écran
              </button>
              {onSwitchMode && (
                <button
                  type="button"
                  onClick={() => onSwitchMode('pc')}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 transition-colors"
                >
                  Retour mode PC
                </button>
              )}
            </div>
          </div>

          {/* Cadre Smartphone Android 16 centré */}
          <div className="flex justify-center py-2">
            <div className="w-[396px] max-w-full rounded-[44px] border-[8px] border-slate-900 bg-slate-900 shadow-2xl overflow-hidden">
              <div className="rounded-[36px] overflow-hidden bg-[#F3F6F6]">
                {phoneBody}
              </div>
            </div>
          </div>
        </div>
      )}
    </MotionConfig>
  );
}

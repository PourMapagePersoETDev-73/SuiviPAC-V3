import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  Minus,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Save,
  Calendar,
  FileSpreadsheet,
  Smartphone,
  Globe,
  FolderSync,
  Loader2,
} from 'lucide-react';
import {
  DayEntry,
  EntriesMap,
  FieldKey,
  PacModel,
  ReferenceData,
} from '../types/pac';
import { FIELDS, LABELS } from '../data/initialData';
import {
  addDaysIso,
  computeDay,
  fmtDateFr,
  fmtShortDateFr,
  frNum,
  getLatestEnteredDate,
  hasN1References,
  parseEcsCycles,
  parseFrFloat,
  todayIso,
} from '../lib/pacEngine';
import {
  isBraveBrowser,
  isFileSystemAccessSupported,
} from '../lib/excelInPlaceWriter';
import { AnnualSavingsGauge, DayComparisonChart } from './Charts';

interface DailyEntryViewProps {
  selectedDate: string;
  onChangeDate: (iso: string) => void;
  entries: EntriesMap;
  reference: ReferenceData;
  model: PacModel;
  onSaveDay: (iso: string, entry: DayEntry) => void;
  onDeleteDay: (iso: string) => void;
  onExportExcel: () => void;
  onDownloadMobile: () => void;
  onPublishOnline: () => void;
  onGoToImport: () => void;
  readOnly?: boolean;
  linkedExcelName?: string | null;
  autoWriteExcel?: boolean;
  writingExcel?: boolean;
  onToggleAutoWriteExcel?: (enabled: boolean) => void;
  onWriteToLinkedExcel?: (opts?: { forcePick?: boolean; onlyDate?: string }) => void;
  onPatchExcelFile?: (file: File) => void;
}

type FormStrings = Record<FieldKey, string>;

function entryToForm(e?: DayEntry): FormStrings {
  const out = {} as FormStrings;
  for (const k of FIELDS) {
    const v = e?.[k];
    if (v === null || v === undefined) {
      out[k] = '';
    } else if (k === 'remarque') {
      out[k] = String(v);
    } else {
      out[k] = String(v).replace('.', ',');
    }
  }
  return out;
}

export function DailyEntryView({
  selectedDate,
  onChangeDate,
  entries,
  reference,
  model,
  onSaveDay,
  onDeleteDay,
  onExportExcel,
  onDownloadMobile,
  onPublishOnline,
  onGoToImport,
  readOnly = false,
  linkedExcelName = null,
  autoWriteExcel = false,
  writingExcel = false,
  onToggleAutoWriteExcel,
  onWriteToLinkedExcel,
  onPatchExcelFile,
}: DailyEntryViewProps) {
  const fsSupported = isFileSystemAccessSupported();
  const isBrave = isBraveBrowser();
  const [form, setForm] = useState<FormStrings>(() => entryToForm(entries[selectedDate]));
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    setForm(entryToForm(entries[selectedDate]));
    setFormError(null);
  }, [selectedDate, entries]);

  const parsedEntry = React.useMemo((): { entry: DayEntry | null; error: string | null } => {
    const e: Partial<DayEntry> = {};
    for (const k of FIELDS) {
      const raw = form[k];
      if (k === 'remarque') {
        e.remarque = raw.trim() ? raw.trim() : null;
      } else {
        const trimmed = raw.trim();
        if (!trimmed) {
          (e as Record<FieldKey, number | null>)[k] = null;
        } else {
          const val = parseFrFloat(trimmed);
          if (val === null) {
            return {
              entry: null,
              error: `Valeur invalide pour « ${LABELS[k]} » : ${raw}`,
            };
          }
          (e as Record<FieldKey, number | null>)[k] = val;
        }
      }
    }
    return { entry: e as DayEntry, error: null };
  }, [form]);

  const hasEdf =
    parsedEntry.entry !== null &&
    (parsedEntry.entry.edf_kwh !== null || parsedEntry.entry.edf_eur !== null);

  const computed = React.useMemo(() => {
    if (!parsedEntry.entry || !hasEdf) return null;
    return computeDay(reference, selectedDate, parsedEntry.entry);
  }, [parsedEntry.entry, hasEdf, reference, selectedDate]);

  const estimatedEdfEur = React.useMemo(() => {
    if (!parsedEntry.entry) return null;
    if (parsedEntry.entry.edf_eur !== null) return null;
    if (parsedEntry.entry.edf_kwh === null) return null;
    return parsedEntry.entry.edf_kwh * reference.params.pe + reference.params.abo;
  }, [parsedEntry.entry, reference.params]);

  const latestEnteredIso = React.useMemo(
    () => getLatestEnteredDate(entries) ?? todayIso(),
    [entries]
  );

  const handleSave = (ev: React.FormEvent) => {
    ev.preventDefault();
    if (parsedEntry.error || !parsedEntry.entry) {
      setFormError(parsedEntry.error || 'Saisie invalide.');
      return;
    }
    const anyNumeric = FIELDS.some(
      (k) => k !== 'remarque' && parsedEntry.entry![k] !== null
    );
    if (!anyNumeric && !parsedEntry.entry.remarque) {
      setFormError('Renseignez au moins une mesure avant d’enregistrer.');
      return;
    }
    setFormError(null);
    onSaveDay(selectedDate, parsedEntry.entry);
    if (autoWriteExcel && linkedExcelName && onWriteToLinkedExcel) {
      onWriteToLinkedExcel({ onlyDate: selectedDate });
    }
    setSavedNotice(`Journée du ${fmtDateFr(selectedDate)} enregistrée.`);
    window.setTimeout(() => setSavedNotice(null), 3000);
  };

  const handleDelete = () => {
    if (!entries[selectedDate]) return;
    onDeleteDay(selectedDate);
    setForm(entryToForm(undefined));
    setSavedNotice(`Saisie du ${fmtDateFr(selectedDate)} supprimée.`);
    window.setTimeout(() => setSavedNotice(null), 3000);
  };

  const totalEdfSpend = React.useMemo(
    () => model.hy_days.reduce((s, d) => s + (d.depense || 0), 0),
    [model.hy_days]
  );

  const n1Available = hasN1References(reference);
  const ecsCycles = parseEcsCycles(parsedEntry.entry?.remarque);

  const prevComputed = React.useMemo(() => {
    const prevIso = addDaysIso(selectedDate, -1);
    const prevEntry = entries[prevIso];
    if (!prevEntry) return null;
    return computeDay(reference, prevIso, prevEntry);
  }, [entries, reference, selectedDate]);

  const weekStrip = React.useMemo(
    () => [-3, -2, -1, 0, 1, 2, 3].map((delta) => addDaysIso(selectedDate, delta)),
    [selectedDate]
  );

  const verdictColor =
    computed?.verdict === "Moins cher que d'habitude"
      ? 'text-emerald-700'
      : computed?.verdict === "Plus cher que d'habitude"
      ? 'text-red-700'
      : 'text-amber-700';

  const VerdictIcon =
    computed?.verdict === "Moins cher que d'habitude"
      ? TrendingDown
      : computed?.verdict === "Plus cher que d'habitude"
      ? TrendingUp
      : Minus;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* Colonne gauche : Formulaire de saisie (mode PC uniquement) */}
      {!readOnly && (
        <form
          onSubmit={handleSave}
          className="lg:col-span-5 rounded-xl border border-slate-200 bg-white p-6"
        >
        <div className="flex flex-wrap items-center justify-between gap-2 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Saisie du jour
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {entries[selectedDate] ? 'Journée déjà enregistrée' : 'Nouvelle journée'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onChangeDate(latestEnteredIso)}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
              title="Aller au dernier jour saisi"
            >
              Dernier saisi
            </button>
            <button
              type="button"
              onClick={() => onChangeDate(todayIso())}
              className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              Aujourd’hui
            </button>
          </div>
        </div>

        {/* Sélecteur de date */}
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onChangeDate(addDaysIso(selectedDate, -1))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
            aria-label="Jour précédent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="relative flex-1">
            <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(ev) => ev.target.value && onChangeDate(ev.target.value)}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm font-mono-num font-medium text-slate-900 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15"
            />
          </div>
          <button
            type="button"
            onClick={() => onChangeDate(addDaysIso(selectedDate, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors shrink-0"
            aria-label="Jour suivant"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {/* Bandeau rapide ±3 jours */}
        <div className="mt-3 grid grid-cols-7 gap-1">
          {weekStrip.map((iso) => {
            const isSelected = iso === selectedDate;
            const hasData = Boolean(entries[iso]);
            return (
              <button
                key={iso}
                type="button"
                onClick={() => onChangeDate(iso)}
                className={`flex flex-col items-center justify-center rounded-md py-1.5 text-[11px] font-mono-num transition-colors ${
                  isSelected
                    ? 'bg-slate-900 text-white font-semibold'
                    : hasData
                    ? 'bg-slate-100 text-slate-800 hover:bg-slate-200/80'
                    : 'text-slate-400 hover:bg-slate-50 hover:text-slate-700'
                }`}
              >
                <span>{fmtShortDateFr(iso)}</span>
                <span className={`mt-0.5 text-[9px] leading-none ${isSelected ? 'text-teal-300' : hasData ? 'text-emerald-700' : 'text-transparent'}`}>
                  ●
                </span>
              </button>
            );
          })}
        </div>

        {/* Champs de mesure */}
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
          {FIELDS.map((key) => {
            const isRemarque = key === 'remarque';
            return (
              <div key={key} className={isRemarque ? 'sm:col-span-2' : ''}>
                <label
                  htmlFor={`field-${key}`}
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  {LABELS[key]}
                </label>
                <input
                  id={`field-${key}`}
                  type="text"
                  inputMode={isRemarque ? 'text' : 'decimal'}
                  value={form[key]}
                  placeholder={
                    key === 'edf_eur' && estimatedEdfEur !== null
                      ? `Calculé : ${frNum(estimatedEdfEur, 2)} €`
                      : isRemarque
                      ? 'ex. cycles ECS : 21'
                      : '–'
                  }
                  onChange={(ev) =>
                    setForm((prev) => ({ ...prev, [key]: ev.target.value }))
                  }
                  className={`h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none focus:ring-2 focus:ring-teal-700/15 ${
                    isRemarque ? '' : 'font-mono-num'
                  }`}
                />
              </div>
            );
          })}
        </div>

        {(formError || parsedEntry.error) && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{formError || parsedEntry.error}</span>
          </div>
        )}

        {savedNotice && (
          <div className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{savedNotice}</span>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-2 pt-4 border-t border-slate-100">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
          >
            <Save className="h-4 w-4" />
            Enregistrer ce jour
          </button>

          {entries[selectedDate] && (
            <button
              type="button"
              onClick={handleDelete}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700 hover:bg-red-50 hover:text-red-700 hover:border-red-200 transition-colors whitespace-nowrap shrink-0"
            >
              <Trash2 className="h-4 w-4" />
              Supprimer
            </button>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {fsSupported && onWriteToLinkedExcel && (
            <button
              type="button"
              disabled={writingExcel}
              onClick={() => onWriteToLinkedExcel()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
              title="Met à jour directement la feuille Journal de votre fichier Suivi_PAC.xlsx sans toucher aux formules ni aux graphiques"
            >
              {writingExcel ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderSync className="h-3.5 w-3.5" />
              )}
              {linkedExcelName
                ? `Écrire dans ${linkedExcelName}`
                : 'Écrire dans Suivi_PAC.xlsx'}
            </button>
          )}
          {!fsSupported && onPatchExcelFile && (
            <label
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-teal-700/30 bg-teal-50 px-3 py-1.5 text-xs font-medium text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0"
              title="Sélectionnez votre Suivi_PAC.xlsx pour le mettre à jour en conservant toutes ses formules et graphiques"
            >
              {writingExcel ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <FolderSync className="h-3.5 w-3.5" />
              )}
              Mettre à jour Suivi_PAC.xlsx
              <input
                type="file"
                accept=".xlsx,.xlsm"
                onChange={(ev) => {
                  const file = ev.target.files?.[0];
                  ev.target.value = '';
                  if (file) onPatchExcelFile(file);
                }}
                className="hidden"
              />
            </label>
          )}
          <button
            type="button"
            onClick={onExportExcel}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
            Exporter copie Excel
          </button>
          <button
            type="button"
            onClick={onPublishOnline}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Globe className="h-3.5 w-3.5 text-teal-700" />
            Publier en ligne
          </button>
          <button
            type="button"
            onClick={onDownloadMobile}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Smartphone className="h-3.5 w-3.5 text-slate-600" />
            Page mobile
          </button>
        </div>

        {(onWriteToLinkedExcel || onPatchExcelFile) && (
          <div className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 text-xs space-y-2">
            {fsSupported ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-slate-600">
                    {linkedExcelName ? (
                      <>
                        Fichier lié : <strong className="text-slate-900">{linkedExcelName}</strong>
                      </>
                    ) : (
                      'Aucun fichier Suivi_PAC.xlsx lié pour le moment.'
                    )}
                  </span>
                  {onWriteToLinkedExcel && (
                    <button
                      type="button"
                      onClick={() => onWriteToLinkedExcel({ forcePick: true })}
                      className="font-medium text-teal-700 hover:underline"
                    >
                      {linkedExcelName ? 'Changer de fichier' : 'Choisir Suivi_PAC.xlsx'}
                    </button>
                  )}
                </div>
                {linkedExcelName && onToggleAutoWriteExcel && (
                  <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoWriteExcel}
                      onChange={(ev) => onToggleAutoWriteExcel(ev.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
                    />
                    <span>Écrire aussi dans {linkedExcelName} lors de « Enregistrer ce jour »</span>
                  </label>
                )}
              </>
            ) : (
              <p className="text-slate-600 leading-relaxed">
                {isBrave ? (
                  <>
                    <strong>Brave</strong> désactive l’écriture directe sur disque par défaut. Pour écrire en 1 clic sans retélécharger, activez{' '}
                    <code className="px-1 py-0.5 rounded bg-slate-200/70 font-mono-num text-[11px]">
                      brave://flags/#file-system-access-api
                    </code>{' '}
                    (Enabled) puis relancez Brave, ou ouvrez l’app dans{' '}
                    <strong>Microsoft Edge</strong> / <strong>Google Chrome</strong>.
                  </>
                ) : (
                  <>
                    L’écriture directe sur disque sans retéléchargement nécessite{' '}
                    <strong>Microsoft Edge</strong> ou <strong>Google Chrome</strong> (fenêtre PC installée).
                  </>
                )}
              </p>
            )}
          </div>
        )}

        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Champs facultatifs : COP affiché, EDF €, gaz, remarques. Si EDF € est vide, il est calculé avec le tarif électricité ({frNum(reference.params.pe, 4)} €/kWh + {frNum(reference.params.abo, 2)} €/j).
        </p>
      </form>
      )}

      {/* Colonne droite : Verdict & 2 graphiques instantanés */}
      <div className={`${readOnly ? 'lg:col-span-12' : 'lg:col-span-7'} space-y-6`}>
        <section className="rounded-xl border border-slate-200 bg-white p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
            <div>
              <p className="text-xs font-medium text-slate-500">
                Verdict du {fmtDateFr(selectedDate)}
              </p>
              {!hasEdf ? (
                <h3 className="mt-1 font-display text-xl font-semibold text-slate-500">
                  {readOnly ? 'Aucune mesure EDF enregistrée pour cette date' : 'Saisissez l’énergie EDF du jour'}
                </h3>
              ) : computed?.verdict ? (
                <div className={`mt-1 flex items-center gap-2 font-display text-xl font-bold ${verdictColor}`}>
                  <VerdictIcon className="h-5 w-5 shrink-0" />
                  <span>{computed.verdict}</span>
                </div>
              ) : (
                <div className="mt-1 font-display text-xl font-semibold text-slate-800">
                  Dépense EDF enregistrée ({frNum(computed?.depense, 2)} €)
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {readOnly && (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => onChangeDate(addDaysIso(selectedDate, -1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                    aria-label="Jour précédent"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={(ev) => ev.target.value && onChangeDate(ev.target.value)}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-mono-num font-medium text-slate-900 focus:border-teal-700 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => onChangeDate(addDaysIso(selectedDate, 1))}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors"
                    aria-label="Jour suivant"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeDate(latestEnteredIso)}
                    className="h-8 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  >
                    Dernier saisi
                  </button>
                </div>
              )}

              {!readOnly && !n1Available && (
                <button
                  type="button"
                  onClick={onGoToImport}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0"
                >
                  Importer Suivi_PAC.xlsx pour N-1
                </button>
              )}
            </div>
          </div>

          {!hasEdf ? (
            <p className="mt-4 text-sm text-slate-600 leading-relaxed">
              Le diagnostic compare la dépense EDF du jour à l’an dernier et à la moyenne des années précédentes (gaz + élec, ±{Math.round(reference.params.fen)} jours), ainsi que le COP réel par rapport au seuil de rentabilité gaz ({frNum(model.kpi.cop_rentab, 2)}).
            </p>
          ) : (
            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-4">
              <div>
                <div className="text-xs text-slate-500">Dépense EDF</div>
                <div className="mt-0.5 text-xl font-bold font-mono-num text-slate-900">
                  {frNum(computed?.depense, 2)} €
                </div>
                {computed?.eco_n1 !== null && computed?.eco_n1 !== undefined ? (
                  <div
                    className={`mt-0.5 text-xs font-medium font-mono-num ${
                      computed.eco_n1 >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {frNum(computed.eco_n1, 2, true)} € vs N-1
                  </div>
                ) : prevComputed?.depense !== null &&
                  prevComputed?.depense !== undefined &&
                  computed?.depense !== null &&
                  computed?.depense !== undefined ? (
                  <div className="mt-0.5 text-xs text-slate-500 font-mono-num">
                    {frNum(computed.depense - prevComputed.depense, 2, true)} € vs veille
                  </div>
                ) : null}
              </div>

              <div>
                <div className="text-xs text-slate-500">Réf. N-1 (gaz + élec)</div>
                <div className="mt-0.5 text-xl font-bold font-mono-num text-slate-900">
                  {computed?.ref_n1 !== null && computed?.ref_n1 !== undefined
                    ? `${frNum(computed.ref_n1, 2)} €`
                    : '–'}
                </div>
                {computed?.benef_n1 !== null && computed?.benef_n1 !== undefined && (
                  <div
                    className={`mt-0.5 text-xs font-medium font-mono-num ${
                      computed.benef_n1 >= 0 ? 'text-emerald-700' : 'text-red-700'
                    }`}
                  >
                    {frNum(computed.benef_n1 * 100, 0, true)} % bénéfice
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-slate-500">COP réel</div>
                <div
                  className={`mt-0.5 text-xl font-bold font-mono-num ${
                    computed?.cop === null || computed?.cop === undefined
                      ? 'text-slate-400'
                      : computed.cop >= reference.params.cop_cible
                      ? 'text-emerald-700'
                      : computed.cop >= model.kpi.cop_rentab
                      ? 'text-amber-700'
                      : 'text-red-700'
                  }`}
                >
                  {frNum(computed?.cop, 2)}
                </div>
                <div className="mt-0.5 text-xs text-slate-500 font-mono-num">
                  cible {frNum(reference.params.cop_cible, 2)} · gaz {frNum(model.kpi.cop_rentab, 2)}
                </div>
              </div>

              <div>
                <div className="text-xs text-slate-500">Élec hors PAC</div>
                <div className="mt-0.5 text-base font-semibold font-mono-num text-slate-900">
                  {computed?.hors_pac !== null && computed?.hors_pac !== undefined
                    ? `${frNum(computed.hors_pac, 1)} kWh`
                    : '–'}
                </div>
                {computed?.elec_ref_kwh !== null && computed?.elec_ref_kwh !== undefined && (
                  <div className="mt-0.5 text-xs text-slate-500 font-mono-num">
                    réf. totale {frNum(computed.elec_ref_kwh, 1)} kWh
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-slate-500">Température ext.</div>
                <div className="mt-0.5 text-base font-semibold font-mono-num text-slate-900">
                  {parsedEntry.entry?.temp !== null && parsedEntry.entry?.temp !== undefined
                    ? `${frNum(parsedEntry.entry.temp, 1)} °C`
                    : '–'}
                </div>
                {computed?.temp_ref !== null && computed?.temp_ref !== undefined && (
                  <div className="mt-0.5 text-xs text-slate-500 font-mono-num">
                    habituel {frNum(computed.temp_ref, 1)} °C
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs text-slate-500">Remarque / ECS</div>
                <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">
                  {ecsCycles ? `Cycles ECS : ${ecsCycles}` : parsedEntry.entry?.remarque || '–'}
                </div>
                {parsedEntry.entry?.gaz_kwh !== null && parsedEntry.entry?.gaz_kwh !== undefined && (
                  <div className="mt-0.5 text-xs text-slate-500 font-mono-num">
                    gaz {frNum(parsedEntry.entry.gaz_kwh, 1)} kWh (non compté)
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 2 graphiques de saisie côte à côte */}
          <div className="mt-6 pt-6 border-t border-slate-100 grid grid-cols-1 md:grid-cols-12 gap-5 items-center">
            <div className="md:col-span-8">
              <h4 className="text-sm font-semibold text-slate-900 mb-2">
                Aujourd’hui (EDF) vs références (€)
              </h4>
              <DayComparisonChart day={computed} model={model} />
            </div>
            <div className="md:col-span-4">
              <h4 className="text-sm font-semibold text-slate-900 mb-2 text-center">
                Objectif économies de l’année
              </h4>
              <AnnualSavingsGauge
                value={model.kpi.eco_cumul}
                target={model.kpi.obj_eur}
                fallbackSpend={totalEdfSpend}
              />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

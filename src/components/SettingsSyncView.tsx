import React, { useState } from 'react';
import {
  FileSpreadsheet,
  Upload,
  Download,
  Smartphone,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Lock,
  FolderSync,
  Loader2,
} from 'lucide-react';
import {
  EntriesMap,
  PacModel,
  Params,
  ReferenceData,
  YearN1,
} from '../types/pac';
import { DEFAULT_YEAR_N1_LABELS, PARAM_DEFAULT } from '../data/initialData';
import {
  downloadBlob,
  exportEntriesJson,
  exportExcelWorkbook,
  importExcelFile,
} from '../lib/excelSync';
import {
  generateEncryptedMobileHtml,
  generateMobileHtml,
} from '../lib/mobilePublisher';
import { frNum, parseFrFloat } from '../lib/pacEngine';
import { isFileSystemAccessSupported } from '../lib/excelInPlaceWriter';

interface SettingsSyncViewProps {
  entries: EntriesMap;
  reference: ReferenceData;
  model: PacModel;
  onImportExcel: (ref: ReferenceData, entries: EntriesMap, overwrite: boolean) => void;
  onImportJson: (entries: EntriesMap, overwrite: boolean) => void;
  onUpdateParams: (params: Params) => void;
  onUpdateYearN1: (yearN1: YearN1 | null) => void;
  onResetDefaultData: () => void;
  linkedExcelName?: string | null;
  writingExcel?: boolean;
  onWriteToLinkedExcel?: (opts?: { forcePick?: boolean }) => void;
  onPatchExcelFile?: (file: File) => void;
}

export function SettingsSyncView({
  entries,
  reference,
  model,
  onImportExcel,
  onImportJson,
  onUpdateParams,
  onUpdateYearN1,
  onResetDefaultData,
  linkedExcelName = null,
  writingExcel = false,
  onWriteToLinkedExcel,
  onPatchExcelFile,
}: SettingsSyncViewProps) {
  const fsSupported = isFileSystemAccessSupported();
  const [overwriteImport, setOverwriteImport] = useState(false);
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [mobilePassword, setMobilePassword] = useState('');

  const [paramsDraft, setParamsDraft] = useState<Params>(() => ({ ...reference.params }));
  const [ynDraft, setYnDraft] = useState<{
    gaz: string[];
    elec: string[];
  }>(() => {
    const g = reference.year_n1?.gaz ?? Array(12).fill(null);
    const e = reference.year_n1?.elec ?? Array(12).fill(null);
    return {
      gaz: g.map((v) => (v !== null ? String(v).replace('.', ',') : '')),
      elec: e.map((v) => (v !== null ? String(v).replace('.', ',') : '')),
    };
  });

  React.useEffect(() => {
    setParamsDraft({ ...reference.params });
    const g = reference.year_n1?.gaz ?? Array(12).fill(null);
    const e = reference.year_n1?.elec ?? Array(12).fill(null);
    setYnDraft({
      gaz: g.map((v) => (v !== null ? String(v).replace('.', ',') : '')),
      elec: e.map((v) => (v !== null ? String(v).replace('.', ',') : '')),
    });
  }, [reference]);

  const notify = (type: 'ok' | 'err', text: string) => {
    setStatusMsg({ type, text });
    window.setTimeout(() => setStatusMsg(null), 5000);
  };

  const handleExcelUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const res = importExcelFile(buf, file.name);
      onImportExcel(res.reference, res.entries, overwriteImport);
      notify(
        'ok',
        `Fichier « ${file.name} » importé : ${res.importedCount} journées lues, ${
          Object.keys(res.reference.n1_total).length
        } jours Ref N-1, ${Object.keys(res.reference.enedis).length} jours Enedis.`
      );
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Erreur lors de la lecture Excel.');
    }
  };

  const handleJsonUpload = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as EntriesMap;
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Format JSON invalide.');
      }
      onImportJson(parsed, overwriteImport);
      notify('ok', `Fichier JSON importé (${Object.keys(parsed).length} journées).`);
    } catch (err) {
      notify('err', err instanceof Error ? err.message : 'Erreur lors de la lecture JSON.');
    }
  };

  const handleSaveParams = (ev: React.FormEvent) => {
    ev.preventDefault();
    onUpdateParams(paramsDraft);

    const gazVals = ynDraft.gaz.map((s) => parseFrFloat(s));
    const elecVals = ynDraft.elec.map((s) => parseFrFloat(s));
    const anyBill = gazVals.some((x) => x !== null) || elecVals.some((x) => x !== null);
    if (anyBill) {
      onUpdateYearN1({
        labels: reference.year_n1?.labels ?? [...DEFAULT_YEAR_N1_LABELS],
        gaz: gazVals,
        elec: elecVals,
      });
    } else {
      onUpdateYearN1(null);
    }
    notify('ok', 'Paramètres et factures N-1 enregistrés.');
  };

  const handleDownloadMobile = async (encrypted: boolean) => {
    if (encrypted && !mobilePassword) {
      notify('err', 'Définissez un mot de passe ci-dessous pour générer la version chiffrée.');
      return;
    }
    const bundle = encrypted
      ? await generateEncryptedMobileHtml(model, mobilePassword)
      : generateMobileHtml(model);
    downloadBlob(
      new Blob([bundle.html], { type: 'text/html;charset=utf-8' }),
      encrypted ? 'index_chiffre.html' : 'index.html'
    );
    downloadBlob(
      new Blob([bundle.dataJson], { type: 'application/json;charset=utf-8' }),
      'data.json'
    );
    notify(
      'ok',
      encrypted
        ? 'Fichiers chiffrés (AES-256-GCM) téléchargés : index_chiffre.html et data.json.'
        : 'Page mobile autonome téléchargée : index.html et data.json.'
    );
  };

  return (
    <div className="space-y-6">
      {statusMsg && (
        <div
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm ${
            statusMsg.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {statusMsg.type === 'ok' ? (
            <CheckCircle2 className="h-4 w-4 shrink-0" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0" />
          )}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Section 1 : Excel & JSON */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              1. Fichier Excel & Données JSON
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {reference.excelFileName
                ? `Dernier Excel importé : ${reference.excelFileName} · ${Object.keys(reference.n1_total).length} jours Ref N-1`
                : 'Importez Suivi_PAC.xlsx pour charger Paramètres, Données (Enedis/Gaz/Météo), Ref N-1 et Journal.'}
            </p>
          </div>
          <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={overwriteImport}
              onChange={(ev) => setOverwriteImport(ev.target.checked)}
              className="rounded border-slate-300 text-teal-700 focus:ring-teal-700"
            />
            Écraser les valeurs existantes à l’import
          </label>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0">
            <Upload className="h-4 w-4" />
            Importer Suivi_PAC.xlsx
            <input
              type="file"
              accept=".xlsx,.xlsm"
              onChange={handleExcelUpload}
              className="hidden"
            />
          </label>

          {onWriteToLinkedExcel && fsSupported && (
            <button
              type="button"
              disabled={writingExcel}
              onClick={() => onWriteToLinkedExcel()}
              className="inline-flex items-center gap-2 rounded-lg border border-teal-700/30 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0"
            >
              {writingExcel ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FolderSync className="h-4 w-4" />
              )}
              {linkedExcelName
                ? `Écrire dans ${linkedExcelName}`
                : 'Lier & écrire dans Suivi_PAC.xlsx'}
            </button>
          )}

          {onPatchExcelFile && !fsSupported && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-teal-700/30 bg-teal-50 px-4 py-2.5 text-sm font-medium text-teal-800 hover:bg-teal-100 transition-colors whitespace-nowrap shrink-0">
              <FolderSync className="h-4 w-4" />
              Mettre à jour Suivi_PAC.xlsx (copie)
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
            onClick={() => exportExcelWorkbook(model, entries)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-700" />
            Télécharger copie Excel (.xlsx)
          </button>

          <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0">
            <Upload className="h-4 w-4" />
            Importer donnees_pac.json
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleJsonUpload}
              className="hidden"
            />
          </label>

          <button
            type="button"
            onClick={() => exportEntriesJson(entries)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-4 w-4" />
            Exporter donnees_pac.json
          </button>

          <button
            type="button"
            onClick={() => {
              onResetDefaultData();
              notify('ok', 'Données initiales restaurées.');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Réinitialiser
          </button>
        </div>
      </section>

      {/* Section 2 : Paramètres de calcul & Factures mensuelles N-1 */}
      <form
        onSubmit={handleSaveParams}
        className="rounded-xl border border-slate-200 bg-white p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900">
              2. Paramètres de calcul & Référence N-1
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Tarifs, seuils de rentabilité (COP seuil actuel :{' '}
              <span className="font-mono-num font-semibold text-slate-800">
                {frNum(paramsDraft.pe / (paramsDraft.pg / paramsDraft.rend), 2)}
              </span>
              ) et factures mensuelles N-1.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setParamsDraft({ ...PARAM_DEFAULT })}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 underline"
          >
            Valeurs par défaut
          </button>
        </div>

        <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
          {(
            [
              ['pe', 'Prix électricité (€/kWh)', 0.0001],
              ['abo', 'Abonnement élec (€/j)', 0.01],
              ['pg', 'Prix gaz (€/kWh)', 0.0001],
              ['abg', 'Abonnement gaz (€/j)', 0.01],
              ['rend', 'Rendement chaudière gaz', 0.05],
              ['fen', 'Fenêtre référence (± jours)', 1],
              ['tol', 'Tolérance moyenne (0.10 = 10%)', 0.01],
              ['cop_cible', 'COP cible', 0.05],
              ['cop_plancher', 'COP plancher', 0.1],
              ['obj_eur', 'Objectif économies (€)', 10],
              ['obj_pct', 'Objectif bénéfice (0.35 = 35%)', 0.01],
            ] as const
          ).map(([key, label, step]) => (
            <div key={key}>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                {label}
              </label>
              <input
                type="number"
                step={step}
                value={paramsDraft[key]}
                onChange={(ev) => {
                  const val = Number(ev.target.value);
                  if (Number.isFinite(val)) {
                    setParamsDraft((prev) => ({ ...prev, [key]: val }));
                  }
                }}
                className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </div>
          ))}

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Date de mise en route
            </label>
            <input
              type="date"
              value={paramsDraft.start}
              onChange={(ev) =>
                setParamsDraft((prev) => ({ ...prev, start: ev.target.value }))
              }
              className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm font-mono-num text-slate-900 focus:border-teal-700 focus:outline-none"
            />
          </div>
        </div>

        {/* Tableau mensuel N-1 (oct -> sept) */}
        <div className="mt-6 pt-5 border-t border-slate-100">
          <h3 className="text-xs font-semibold text-slate-700 mb-3">
            Factures mensuelles N-1 (octobre → septembre, € TTC) — alimente le graphique 4 et le repli N-1
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-3 text-left font-medium">Mois</th>
                  {DEFAULT_YEAR_N1_LABELS.map((lab) => (
                    <th key={lab} className="px-1.5 py-2 text-center font-medium">
                      {lab}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700 whitespace-nowrap">
                    Gaz N-1 (€)
                  </td>
                  {ynDraft.gaz.map((v, i) => (
                    <td key={i} className="px-1 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={v}
                        placeholder="–"
                        onChange={(ev) => {
                          const next = [...ynDraft.gaz];
                          next[i] = ev.target.value;
                          setYnDraft((prev) => ({ ...prev, gaz: next }));
                        }}
                        className="h-8 w-16 rounded border border-slate-200 px-1.5 text-right font-mono-num text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="py-2 pr-3 font-medium text-slate-700 whitespace-nowrap">
                    Élec N-1 (€)
                  </td>
                  {ynDraft.elec.map((v, i) => (
                    <td key={i} className="px-1 py-1.5">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={v}
                        placeholder="–"
                        onChange={(ev) => {
                          const next = [...ynDraft.elec];
                          next[i] = ev.target.value;
                          setYnDraft((prev) => ({ ...prev, elec: next }));
                        }}
                        className="h-8 w-16 rounded border border-slate-200 px-1.5 text-right font-mono-num text-slate-900 focus:border-teal-700 focus:outline-none"
                      />
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            type="submit"
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors whitespace-nowrap shrink-0"
          >
            Appliquer les paramètres
          </button>
        </div>
      </form>

      {/* Section 3 : Export page mobile hors-ligne */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="pb-4 border-b border-slate-100">
          <h2 className="font-display text-base font-semibold text-slate-900">
            3. Page mobile hors-ligne (export statique)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Votre page en ligne (Web / Android 16) est déjà synchronisée en direct via Firebase à chaque sauvegarde. Utilisez ces boutons uniquement si vous souhaitez télécharger une copie statique autonome (en clair ou chiffrée AES-256-GCM).
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => handleDownloadMobile(false)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Smartphone className="h-4 w-4 text-teal-700" />
            Télécharger page mobile (en clair)
          </button>

          <button
            type="button"
            onClick={() => handleDownloadMobile(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Lock className="h-4 w-4 text-slate-700" />
            Télécharger version chiffrée
          </button>
        </div>

        <div className="mt-4 max-w-md">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Mot de passe de chiffrement (pour la version chiffrée uniquement)
          </label>
          <input
            type="password"
            value={mobilePassword}
            placeholder="Phrase secrète pour déverrouiller sur mobile"
            onChange={(ev) => setMobilePassword(ev.target.value)}
            className="h-9 w-full rounded-lg border border-slate-200 px-3 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
          />
        </div>
      </section>
    </div>
  );
}

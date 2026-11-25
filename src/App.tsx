import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import {
  CalendarPlus,
  BarChart3,
  Table2,
  SlidersHorizontal,
  FileSpreadsheet,
  Menu,
  X,
  Monitor,
  Globe,
  Smartphone,
  Eye,
  Cloud,
  LogOut,
  Loader2,
  Palette,
  Sun,
  Contrast,
  Moon,
} from 'lucide-react';
import {
  ConsumptionGoals,
  DayEntry,
  EntriesMap,
  Params,
  ReferenceData,
  ThemeMode,
  YearN1,
} from './types/pac';
import {
  DEFAULT_CONSUMPTION_GOALS,
  EMPTY_REFERENCE,
  INITIAL_ENTRIES,
} from './data/initialData';
import {
  buildModel,
  fmtDateFr,
  frNum,
  getLatestEnteredDate,
  mergeEntries,
} from './lib/pacEngine';
import { downloadBlob, exportExcelWorkbook } from './lib/excelSync';
import {
  getSavedExcelHandle,
  patchAndDownloadExcelFile,
  writeEntriesToLinkedExcel,
} from './lib/excelInPlaceWriter';
import { generateMobileHtml } from './lib/mobilePublisher';
import { auth } from './lib/firebase';
import {
  batchUpsertEntriesToCloud,
  bootstrapCloudWorkspaceIfEmpty,
  deleteDayEntryFromCloud,
  ensureUserWorkspace,
  replaceEntriesInCloud,
  saveDayEntryToCloud,
  saveGoalsToCloud,
  saveReferenceToCloud,
  subscribeEntries,
  subscribeGoals,
  subscribeReference,
} from './lib/pacCloudSync';
import { isStandalonePWA } from './hooks/usePWA';
import { AuthGate } from './components/AuthGate';
import { OfflineIndicator, PWAInstallButton } from './components/PWAStatus';
import { DailyEntryView } from './components/DailyEntryView';
import { DashboardView } from './components/DashboardView';
import { JournalView } from './components/JournalView';
import { SettingsSyncView } from './components/SettingsSyncView';
import { Android16View } from './components/Android16View';
import { ThemesView } from './components/ThemesView';

type TabId = 'saisie' | 'suivi' | 'journal' | 'parametres' | 'themes';
type AppDisplayMode = 'pc' | 'web' | 'android';

function initialDisplayMode(): AppDisplayMode {
  try {
    const p = new URLSearchParams(window.location.search).get('mode');
    if (p === 'web' || p === 'android' || p === 'pc') return p;
    if (isStandalonePWA() && window.innerWidth < 768) return 'android';
  } catch {
    // Ignore SSR/URL errors
  }
  return 'pc';
}

const STORAGE_ENTRIES = 'suivi_pac_entries_v1';
const STORAGE_REF = 'suivi_pac_reference_v1';
const STORAGE_GOALS = 'suivi_pac_goals_v1';
const STORAGE_THEME = 'suivi_pac_theme_v1';
const STORAGE_AUTO_EXCEL = 'suivi_pac_auto_excel_v1';

function loadThemeStorage(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_THEME);
    if (raw === 'light' || raw === 'medium' || raw === 'dark') return raw;
  } catch {
    // Ignore storage errors
  }
  return 'light';
}

function loadAutoExcelStorage(): boolean {
  try {
    return localStorage.getItem(STORAGE_AUTO_EXCEL) === '1';
  } catch {
    return false;
  }
}

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const NAV_ITEMS: Array<{ id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'saisie', label: 'Saisie du jour', icon: CalendarPlus },
  { id: 'suivi', label: 'Suivi & Graphiques', icon: BarChart3 },
  { id: 'journal', label: 'Journal', icon: Table2 },
  { id: 'parametres', label: 'Excel & Réglages', icon: SlidersHorizontal },
  { id: 'themes', label: 'Thèmes', icon: Palette },
];

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudSynced, setCloudSynced] = useState(false);
  const [fatalCloudError, setFatalCloudError] = useState<Error | null>(null);

  if (fatalCloudError) {
    throw fatalCloudError;
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCloudSynced(false);
      }
    });
    return () => unsub();
  }, []);

  const [displayMode, setDisplayMode] = useState<AppDisplayMode>(initialDisplayMode);
  const [isMobileScreen, setIsMobileScreen] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );
  const [tab, setTab] = useState<TabId>('saisie');
  const [theme, setTheme] = useState<ThemeMode>(loadThemeStorage);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [linkedExcelName, setLinkedExcelName] = useState<string | null>(null);
  const [autoWriteExcel, setAutoWriteExcel] = useState<boolean>(loadAutoExcelStorage);
  const [writingExcel, setWritingExcel] = useState(false);

  useEffect(() => {
    void getSavedExcelHandle().then((h) => {
      if (h?.name) setLinkedExcelName(h.name);
    });
  }, []);

  const handleToggleAutoWriteExcel = (enabled: boolean) => {
    setAutoWriteExcel(enabled);
    try {
      localStorage.setItem(STORAGE_AUTO_EXCEL, enabled ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem(STORAGE_THEME, theme);
    } catch {
      // Ignore storage errors
    }
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) =>
      prev === 'light' ? 'medium' : prev === 'medium' ? 'dark' : 'light'
    );
  };

  useEffect(() => {
    const onResize = () => setIsMobileScreen(window.innerWidth < 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const handleSwitchMode = (nextMode: AppDisplayMode) => {
    setDisplayMode(nextMode);
    if (nextMode === 'web' && tab === 'parametres') {
      setTab('saisie');
    }
    try {
      const url = new URL(window.location.href);
      if (nextMode === 'pc') url.searchParams.delete('mode');
      else url.searchParams.set('mode', nextMode);
      window.history.replaceState({}, '', url.toString());
    } catch {
      // Ignore history errors
    }
  };

  const [entries, setEntries] = useState<EntriesMap>(() =>
    loadJsonStorage<EntriesMap>(STORAGE_ENTRIES, INITIAL_ENTRIES)
  );
  const [reference, setReference] = useState<ReferenceData>(() =>
    loadJsonStorage<ReferenceData>(STORAGE_REF, EMPTY_REFERENCE)
  );
  const [consumptionGoals, setConsumptionGoals] = useState<ConsumptionGoals>(() =>
    loadJsonStorage<ConsumptionGoals>(STORAGE_GOALS, DEFAULT_CONSUMPTION_GOALS)
  );

  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const referenceRef = useRef(reference);
  referenceRef.current = reference;
  const goalsRef = useRef(consumptionGoals);
  goalsRef.current = consumptionGoals;

  const [selectedDate, setSelectedDate] = useState<string>(() => {
    return getLatestEnteredDate(entries) ?? '2026-11-18';
  });
  const userPickedDateRef = useRef(false);

  const handleChangeSelectedDate = (iso: string) => {
    userPickedDateRef.current = true;
    setSelectedDate(iso);
  };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_ENTRIES, JSON.stringify(entries));
    } catch {
      // Ignore storage quota errors
    }
  }, [entries]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_REF, JSON.stringify(reference));
    } catch {
      // Ignore storage quota errors
    }
  }, [reference]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_GOALS, JSON.stringify(consumptionGoals));
    } catch {
      // Ignore storage quota errors
    }
  }, [consumptionGoals]);

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    window.setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    if (!authReady || !user || !user.emailVerified) {
      return;
    }

    let cancelled = false;
    let unsubEntries: (() => void) | null = null;
    let unsubRef: (() => void) | null = null;
    let unsubGoals: (() => void) | null = null;

    const handleSyncError = (err: Error) => {
      if (cancelled) return;
      if (err.message.includes('permission-denied') || err.message.includes('Missing or insufficient permissions')) {
        setFatalCloudError(err);
      } else {
        showToast('err', 'Synchronisation cloud temporairement indisponible.');
      }
    };

    const startSync = async () => {
      try {
        await ensureUserWorkspace(user);
        if (cancelled) return;
        await bootstrapCloudWorkspaceIfEmpty(
          user.uid,
          entriesRef.current,
          referenceRef.current,
          goalsRef.current
        );
        if (cancelled) return;

        unsubEntries = subscribeEntries(
          user.uid,
          (cloudEntries) => {
            if (cancelled) return;
            setEntries(cloudEntries);
            setCloudSynced(true);
            if (!userPickedDateRef.current) {
              const latest = getLatestEnteredDate(cloudEntries);
              if (latest) {
                setSelectedDate(latest);
              }
            }
          },
          handleSyncError
        );

        unsubRef = subscribeReference(
          user.uid,
          (cloudRef) => {
            if (cancelled) return;
            setReference(cloudRef);
          },
          handleSyncError
        );

        unsubGoals = subscribeGoals(
          user.uid,
          (cloudGoals) => {
            if (cancelled) return;
            setConsumptionGoals(cloudGoals);
          },
          handleSyncError
        );
      } catch (err) {
        handleSyncError(err instanceof Error ? err : new Error(String(err)));
      }
    };

    void startSync();

    return () => {
      cancelled = true;
      unsubEntries?.();
      unsubRef?.();
      unsubGoals?.();
    };
  }, [authReady, user]);

  const model = useMemo(() => buildModel(reference, entries), [reference, entries]);

  const canMutate = Boolean(user && user.emailVerified && displayMode === 'pc');

  const handleSaveDay = async (iso: string, entry: DayEntry): Promise<boolean> => {
    if (!canMutate || !user) return false;
    const nextEntries = {
      ...entriesRef.current,
      [iso]: entry,
    };
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
    try {
      await saveDayEntryToCloud(user.uid, iso, entry);
      return true;
    } catch (err) {
      showToast('err', err instanceof Error ? err.message : 'Échec de synchronisation du jour.');
      return false;
    }
  };

  const handleWriteToLinkedExcel = async (opts?: {
    forcePick?: boolean;
    onlyDate?: string;
  }): Promise<boolean> => {
    if (!canMutate) return false;
    setWritingExcel(true);
    try {
      const res = await writeEntriesToLinkedExcel(entriesRef.current, {
        forcePick: opts?.forcePick,
        onlyDates: opts?.onlyDate ? [opts.onlyDate] : undefined,
      });
      setLinkedExcelName(res.fileName);
      if (res.writtenCount === 0 && res.notFoundDates.length > 0) {
        showToast(
          'err',
          `Aucune date correspondante trouvée dans « ${res.fileName} » (${res.notFoundDates.slice(0, 3).join(', ')}).`
        );
        return false;
      }
      const extra =
        res.notFoundDates.length > 0
          ? ` (${res.notFoundDates.length} date(s) hors plage du classeur)`
          : '';
      showToast(
        'ok',
        `${res.writtenCount} journée(s) écrite(s) directement dans « ${res.fileName} »${extra}.`
      );
      return true;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return false;
      }
      showToast(
        'err',
        err instanceof Error ? err.message : 'Impossible d’écrire dans le fichier Excel.'
      );
      return false;
    } finally {
      setWritingExcel(false);
    }
  };

  const handlePatchExcelFile = async (file: File): Promise<boolean> => {
    if (!canMutate) return false;
    setWritingExcel(true);
    try {
      const res = await patchAndDownloadExcelFile(file, entriesRef.current);
      if (res.writtenCount === 0 && res.notFoundDates.length > 0) {
        showToast(
          'err',
          `Aucune date correspondante trouvée dans « ${res.fileName} ».`
        );
        return false;
      }
      showToast(
        'ok',
        `« ${res.fileName} » mis à jour (${res.writtenCount} journée(s)) et téléchargé avec toutes vos formules et graphiques.`
      );
      return true;
    } catch (err) {
      showToast(
        'err',
        err instanceof Error ? err.message : 'Impossible de mettre à jour le fichier Excel.'
      );
      return false;
    } finally {
      setWritingExcel(false);
    }
  };

  const handleSaveBoth = async (
    iso: string,
    entry: DayEntry
  ): Promise<{ cloudOk: boolean; excelOk: boolean }> => {
    if (!canMutate || !user) return { cloudOk: false, excelOk: false };
    const cloudPromise = handleSaveDay(iso, entry);

    if (!window.showOpenFilePicker) {
      const cloudOk = await cloudPromise;
      if (cloudOk) {
        showToast(
          'ok',
          'Enregistré dans le Cloud. Utilisez « Mettre à jour Suivi_PAC.xlsx » pour compléter la sauvegarde locale.'
        );
      }
      return { cloudOk, excelOk: false };
    }

    const excelPromise = handleWriteToLinkedExcel();
    const [cloudOk, excelOk] = await Promise.all([cloudPromise, excelPromise]);
    return { cloudOk, excelOk };
  };

  const handleDeleteDay = (iso: string) => {
    if (!canMutate || !user) return;
    setEntries((prev) => {
      const next = { ...prev };
      delete next[iso];
      return next;
    });
    void deleteDayEntryFromCloud(user.uid, iso).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de suppression cloud.');
    });
  };

  const handleImportExcel = (
    importedRef: ReferenceData,
    importedEntries: EntriesMap,
    overwrite: boolean
  ) => {
    if (!canMutate || !user) return;
    const merged = mergeEntries(entriesRef.current, importedEntries, overwrite);
    setReference(importedRef);
    setEntries(merged);
    void Promise.all([
      saveReferenceToCloud(user.uid, importedRef),
      batchUpsertEntriesToCloud(user.uid, merged),
    ]).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de synchronisation Excel.');
    });
  };

  const handleImportJson = (incoming: EntriesMap, overwrite: boolean) => {
    if (!canMutate || !user) return;
    const merged = mergeEntries(entriesRef.current, incoming, overwrite);
    setEntries(merged);
    void batchUpsertEntriesToCloud(user.uid, merged).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de synchronisation JSON.');
    });
  };

  const handleUpdateParams = (params: Params) => {
    if (!canMutate || !user) return;
    const nextRef: ReferenceData = { ...referenceRef.current, params };
    setReference(nextRef);
    void saveReferenceToCloud(user.uid, nextRef).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de sauvegarde des paramètres.');
    });
  };

  const handleUpdateYearN1 = (year_n1: YearN1 | null) => {
    if (!canMutate || !user) return;
    const nextRef: ReferenceData = { ...referenceRef.current, year_n1 };
    setReference(nextRef);
    void saveReferenceToCloud(user.uid, nextRef).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de sauvegarde N-1.');
    });
  };

  const handleUpdateConsumptionGoals = (nextGoals: ConsumptionGoals) => {
    if (!canMutate || !user) return;
    setConsumptionGoals(nextGoals);
    void saveGoalsToCloud(user.uid, nextGoals).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de sauvegarde des objectifs.');
    });
  };

  const handleDownloadMobile = () => {
    const bundle = generateMobileHtml(model);
    downloadBlob(
      new Blob([bundle.html], { type: 'text/html;charset=utf-8' }),
      'index.html'
    );
    downloadBlob(
      new Blob([bundle.dataJson], { type: 'application/json;charset=utf-8' }),
      'data.json'
    );
    showToast('ok', 'Page mobile générée (index.html et data.json).');
  };

  const handleResetDefaultData = () => {
    if (!canMutate || !user) return;
    const previousDates = Object.keys(entriesRef.current);
    setEntries(INITIAL_ENTRIES);
    setReference(EMPTY_REFERENCE);
    void Promise.all([
      replaceEntriesInCloud(user.uid, INITIAL_ENTRIES, previousDates),
      saveReferenceToCloud(user.uid, EMPTY_REFERENCE),
    ]).catch((err) => {
      showToast('err', err instanceof Error ? err.message : 'Échec de réinitialisation cloud.');
    });
  };

  const handleSignOut = () => {
    userPickedDateRef.current = false;
    setCloudSynced(false);
    void signOut(auth);
  };

  const isWebReadOnly = displayMode === 'web';
  const visibleNavItems = useMemo(
    () =>
      isWebReadOnly
        ? NAV_ITEMS.filter(
            (n) =>
              n.id === 'saisie' ||
              n.id === 'suivi' ||
              n.id === 'journal' ||
              n.id === 'themes'
          ).map((n) =>
            n.id === 'saisie'
              ? { ...n, label: 'Verdict du jour', icon: Eye }
              : n
          )
        : NAV_ITEMS,
    [isWebReadOnly]
  );
  const activeNav =
    visibleNavItems.find((n) => n.id === tab) ?? visibleNavItems[0];

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="flex items-center gap-3 text-sm font-medium text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin text-teal-700" />
          <span>Initialisation sécurisée de Suivi PAC…</span>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <AuthGate />
        <OfflineIndicator />
      </>
    );
  }

  if (!user.emailVerified) {
    return (
      <>
        <AuthGate errorMessage="Votre adresse e-mail Google doit être vérifiée pour accéder à votre espace Suivi PAC." />
        <OfflineIndicator />
      </>
    );
  }

  if (displayMode === 'android' && isMobileScreen) {
    return (
      <>
        <Android16View
          model={model}
          reference={reference}
          consumptionGoals={consumptionGoals}
          isMobileScreen={true}
          onSwitchMode={handleSwitchMode}
          userEmail={user.email}
          cloudSynced={cloudSynced}
          onSignOut={handleSignOut}
          theme={theme}
          onCycleTheme={cycleTheme}
        />
        <OfflineIndicator />
      </>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex">
      {/* Sidebar Desktop */}
      {displayMode !== 'android' && (
        <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-slate-200 bg-white">
          <div className="px-6 py-5 border-b border-slate-100">
            <div className="flex items-center justify-between gap-2">
              <div className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap">
                Suivi PAC
              </div>
              {isWebReadOnly && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-teal-700">
                  <Eye className="h-3 w-3" />
                  Lecture
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center justify-between gap-2 text-xs text-slate-500 font-mono-num">
              <span>{Object.keys(entries).length} jours enregistrés</span>
              {cloudSynced && (
                <span
                  title="Synchronisation cloud active"
                  className="inline-flex items-center gap-1 text-[11px] font-sans font-medium text-emerald-700"
                >
                  <Cloud className="h-3 w-3" />
                  Sync
                </span>
              )}
            </div>
          </div>

          <nav className="flex-1 p-3 space-y-1">
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeNav.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`w-full flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>

          <div className="p-4 border-t border-slate-100 text-xs text-slate-500 space-y-2.5">
            <div className="space-y-1">
              <div className="font-medium text-slate-700">
                {isWebReadOnly ? 'Consultation Web' : 'Année de chauffage'}
              </div>
              <div className="font-mono-num">
                {fmtDateFr(model.kpi.hy0)} – {fmtDateFr(model.kpi.hy1)}
              </div>
              <div className="pt-1 font-mono-num">
                COP moyen : <span className="font-semibold text-slate-800">{frNum(model.kpi.cop_moyen, 2)}</span>
              </div>
            </div>

            <div className="pt-2.5 border-t border-slate-100 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-slate-500" title={user.email || undefined}>
                {user.email || 'Compte connecté'}
              </span>
              <button
                type="button"
                onClick={handleSignOut}
                title="Se déconnecter"
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors shrink-0"
              >
                <LogOut className="h-3 w-3" />
                Quitter
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Mobile Drawer */}
      {mobileMenuOpen && displayMode !== 'android' && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/40"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="relative z-10 w-64 max-w-[80vw] bg-white h-full flex flex-col border-r border-slate-200">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <span className="font-display text-base font-bold text-slate-900">
                Suivi PAC
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                aria-label="Fermer le menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <nav className="p-3 space-y-1 flex-1">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = activeNav.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTab(item.id);
                      setMobileMenuOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                      active
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
            <div className="p-4 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-slate-500">{user.email}</span>
              <button
                type="button"
                onClick={() => {
                  setMobileMenuOpen(false);
                  handleSignOut();
                }}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium text-slate-700 hover:bg-slate-100 shrink-0"
              >
                <LogOut className="h-3.5 w-3.5" />
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Top Bar Contract */}
        <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-xs border-b border-slate-200 px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {displayMode !== 'android' && (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:bg-slate-100 shrink-0"
                aria-label="Ouvrir le menu"
              >
                <Menu className="h-5 w-5" />
              </button>
            )}
            <div className="flex items-center gap-2 text-sm min-w-0 truncate">
              <span
                className={`${
                  displayMode === 'android' ? '' : 'lg:hidden'
                } font-display font-bold text-slate-900 whitespace-nowrap`}
              >
                Suivi PAC
              </span>
              <span
                className={`${
                  displayMode === 'android' ? '' : 'lg:hidden'
                } text-slate-300`}
              >
                /
              </span>
              <h1 className="font-display font-semibold text-slate-900 truncate">
                {displayMode === 'android'
                  ? 'Aperçu Android 16'
                  : isWebReadOnly
                  ? `${activeNav.label} · Lecture seule`
                  : activeNav.label}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton compact />

            <button
              type="button"
              onClick={cycleTheme}
              title={`Thème : ${theme === 'light' ? 'Clair' : theme === 'medium' ? 'Médium' : 'Dark'}`}
              aria-label="Changer de thème"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
            >
              {theme === 'light' ? (
                <Sun className="h-3.5 w-3.5 text-amber-600" />
              ) : theme === 'medium' ? (
                <Contrast className="h-3.5 w-3.5 text-teal-700" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-sky-400" />
              )}
              <span className="hidden md:inline">
                {theme === 'light' ? 'Clair' : theme === 'medium' ? 'Médium' : 'Dark'}
              </span>
            </button>

            {/* Sélecteur de cible : PC / Web lecture seule / Android 16 */}
            <div
              className="flex items-center gap-0.5 rounded-lg bg-slate-100 p-1"
              role="group"
              aria-label="Mode d'affichage"
            >
              {(
                [
                  { id: 'pc', label: 'PC', icon: Monitor },
                  { id: 'web', label: 'Web', icon: Globe },
                  { id: 'android', label: 'Android 16', icon: Smartphone },
                ] as const
              ).map((m) => {
                const Icon = m.icon;
                const active = displayMode === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => handleSwitchMode(m.id)}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0" />
                    <span className="hidden sm:inline">{m.label}</span>
                  </button>
                );
              })}
            </div>

            {displayMode === 'pc' && (
              <>
                <button
                  type="button"
                  onClick={() => exportExcelWorkbook(model, entries)}
                  className="hidden md:inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-700" />
                  Exporter Excel
                </button>
                <button
                  type="button"
                  onClick={() => setTab('saisie')}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-teal-700 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0"
                >
                  <CalendarPlus className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Saisir un jour</span>
                </button>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 sm:px-6 lg:px-8 pt-6 pb-20 lg:pb-8 max-w-[1400px] w-full mx-auto">
          {toast && (
            <div
              className={`mb-4 rounded-xl border px-4 py-2.5 text-sm font-medium ${
                toast.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {toast.text}
            </div>
          )}

          {displayMode === 'android' ? (
            <Android16View
              model={model}
              reference={reference}
              consumptionGoals={consumptionGoals}
              isMobileScreen={false}
              onSwitchMode={handleSwitchMode}
              userEmail={user.email}
              cloudSynced={cloudSynced}
              onSignOut={handleSignOut}
              theme={theme}
              onCycleTheme={cycleTheme}
            />
          ) : (
            <>
              {activeNav.id === 'saisie' && (
                <DailyEntryView
                  selectedDate={selectedDate}
                  onChangeDate={handleChangeSelectedDate}
                  entries={entries}
                  reference={reference}
                  model={model}
                  onSaveDay={handleSaveDay}
                  onSaveBoth={isWebReadOnly ? undefined : handleSaveBoth}
                  onDeleteDay={handleDeleteDay}
                  onExportExcel={() => exportExcelWorkbook(model, entries)}
                  onDownloadMobile={handleDownloadMobile}
                  onGoToImport={() => setTab('parametres')}
                  readOnly={isWebReadOnly}
                  linkedExcelName={isWebReadOnly ? undefined : linkedExcelName}
                  autoWriteExcel={autoWriteExcel}
                  writingExcel={writingExcel}
                  onToggleAutoWriteExcel={
                    isWebReadOnly ? undefined : handleToggleAutoWriteExcel
                  }
                  onWriteToLinkedExcel={
                    isWebReadOnly ? undefined : handleWriteToLinkedExcel
                  }
                  onPatchExcelFile={
                    isWebReadOnly ? undefined : handlePatchExcelFile
                  }
                />
              )}

              {activeNav.id === 'suivi' && (
                <DashboardView
                  model={model}
                  reference={reference}
                  consumptionGoals={consumptionGoals}
                  onUpdateConsumptionGoals={handleUpdateConsumptionGoals}
                  onGoToImport={() => setTab('parametres')}
                  readOnly={isWebReadOnly}
                />
              )}

              {activeNav.id === 'journal' && (
                <JournalView
                  model={model}
                  onEditDay={(iso) => {
                    handleChangeSelectedDate(iso);
                    setTab('saisie');
                  }}
                  onDeleteDay={handleDeleteDay}
                  readOnly={isWebReadOnly}
                />
              )}

              {activeNav.id === 'parametres' && !isWebReadOnly && (
                <SettingsSyncView
                  entries={entries}
                  reference={reference}
                  model={model}
                  onImportExcel={handleImportExcel}
                  onImportJson={handleImportJson}
                  onUpdateParams={handleUpdateParams}
                  onUpdateYearN1={handleUpdateYearN1}
                  onResetDefaultData={handleResetDefaultData}
                  linkedExcelName={linkedExcelName}
                  writingExcel={writingExcel}
                  onWriteToLinkedExcel={handleWriteToLinkedExcel}
                  onPatchExcelFile={handlePatchExcelFile}
                />
              )}

              {activeNav.id === 'themes' && (
                <ThemesView theme={theme} onChangeTheme={setTheme} />
              )}
            </>
          )}
        </main>

        {/* Navigation mobile compacte */}
        {displayMode !== 'android' && (
          <nav
            className={`lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur-xs grid ${
              isWebReadOnly ? 'grid-cols-4' : 'grid-cols-5'
            } h-14`}
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const active = activeNav.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors ${
                    active ? 'text-teal-700' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate max-w-[70px]">
                    {item.id === 'saisie'
                      ? isWebReadOnly
                        ? 'Verdict'
                        : 'Saisie'
                      : item.id === 'suivi'
                      ? 'Suivi'
                      : item.id === 'journal'
                      ? 'Journal'
                      : item.id === 'parametres'
                      ? 'Réglages'
                      : 'Thèmes'}
                  </span>
                </button>
              );
            })}
          </nav>
        )}
      </div>

      <OfflineIndicator />
    </div>
  );
}

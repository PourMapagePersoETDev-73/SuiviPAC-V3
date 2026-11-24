import React, { useMemo, useState } from 'react';
import { Download, Search, Trash2, ArrowUpDown, Edit3 } from 'lucide-react';
import { ComputedDay, PacModel } from '../types/pac';
import { fmtDateFr, frNum, parseEcsCycles } from '../lib/pacEngine';
import { exportCsvJournal } from '../lib/excelSync';

interface JournalViewProps {
  model: PacModel;
  onEditDay: (iso: string) => void;
  onDeleteDay: (iso: string) => void;
  readOnly?: boolean;
}

type VerdictFilter = 'all' | 'good' | 'mid' | 'bad';
type SortKey = 'date' | 'depense' | 'cop' | 'temp' | 'eco';

export function JournalView({
  model,
  onEditDay,
  onDeleteDay,
  readOnly = false,
}: JournalViewProps) {
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('all');
  const [verdictFilter, setVerdictFilter] = useState<VerdictFilter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);

  const monthsAvailable = useMemo(() => {
    const set = new Set<string>();
    for (const d of model.days) {
      set.add(d.date.slice(0, 7));
    }
    return Array.from(set).sort().reverse();
  }, [model.days]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = model.days.filter((r) => {
      if (monthFilter !== 'all' && !r.date.startsWith(monthFilter)) return false;
      if (verdictFilter === 'good' && !r.verdict.startsWith('Moins')) return false;
      if (verdictFilter === 'mid' && r.verdict !== 'Dans la moyenne') return false;
      if (verdictFilter === 'bad' && !r.verdict.startsWith('Plus')) return false;
      if (q) {
        const fr = fmtDateFr(r.date).toLowerCase();
        const rem = (r.entry.remarque || '').toLowerCase();
        if (!fr.includes(q) && !r.date.includes(q) && !rem.includes(q)) return false;
      }
      return true;
    });

    const dir = sortAsc ? 1 : -1;
    return [...list].sort((a, b) => {
      if (sortKey === 'date') return a.date.localeCompare(b.date) * dir;
      const getVal = (x: ComputedDay): number => {
        if (sortKey === 'depense') return x.depense ?? -Infinity;
        if (sortKey === 'cop') return x.cop ?? -Infinity;
        if (sortKey === 'temp') return x.entry.temp ?? -Infinity;
        return x.eco_n1 ?? -Infinity;
      };
      return (getVal(a) - getVal(b)) * dir;
    });
  }, [model.days, monthFilter, verdictFilter, search, sortKey, sortAsc]);

  const toggleSort = (k: SortKey) => {
    if (sortKey === k) setSortAsc((p) => !p);
    else {
      setSortKey(k);
      setSortAsc(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(ev) => setSearch(ev.target.value)}
                placeholder="Rechercher date ou remarque…"
                className="h-9 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-700 focus:outline-none"
              />
            </div>

            <select
              value={monthFilter}
              onChange={(ev) => setMonthFilter(ev.target.value)}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 focus:border-teal-700 focus:outline-none"
            >
              <option value="all">Tous les mois ({model.days.length} j)</option>
              {monthsAvailable.map((ym) => (
                <option key={ym} value={ym}>
                  {ym.slice(5, 7)}/{ym.slice(0, 4)}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ['all', 'Tous'],
                  ['good', 'Économie'],
                  ['mid', 'Moyenne'],
                  ['bad', 'Surcoût'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setVerdictFilter(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    verdictFilter === id
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            onClick={() => exportCsvJournal(model)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="h-3.5 w-3.5" />
            Exporter CSV
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/70 text-xs font-medium text-slate-500">
                <th className="px-4 py-3 text-left">
                  <button
                    type="button"
                    onClick={() => toggleSort('date')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    Date
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('temp')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    Temp.
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-3 text-right">PAC conso</th>
                <th className="px-3 py-3 text-right">PAC prod</th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('cop')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    COP réel
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-3 text-right">EDF kWh</th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('depense')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    Dépense €
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => toggleSort('eco')}
                    className="inline-flex items-center gap-1 hover:text-slate-900"
                  >
                    Éco. N-1
                    <ArrowUpDown className="h-3 w-3" />
                  </button>
                </th>
                <th className="px-3 py-3 text-left">Remarque</th>
                {!readOnly && <th className="px-4 py-3 text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={readOnly ? 9 : 10} className="px-4 py-10 text-center text-slate-500">
                    Aucune journée ne correspond aux filtres sélectionnés.
                  </td>
                </tr>
              ) : (
                filtered.map((r) => {
                  const ecs = parseEcsCycles(r.entry.remarque);
                  return (
                    <tr
                      key={r.date}
                      onClick={() => {
                        if (!readOnly) onEditDay(r.date);
                      }}
                      className={`${
                        readOnly ? '' : 'cursor-pointer'
                      } hover:bg-slate-50/90 transition-colors`}
                    >
                      <td className="px-4 py-2.5 font-mono-num font-medium text-slate-900 whitespace-nowrap">
                        {fmtDateFr(r.date)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num text-slate-700">
                        {r.entry.temp !== null ? `${frNum(r.entry.temp, 1)} °C` : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num text-slate-700">
                        {r.entry.pac_conso !== null ? `${frNum(r.entry.pac_conso, 1)}` : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num text-slate-700">
                        {r.entry.pac_prod !== null ? `${frNum(r.entry.pac_prod, 1)}` : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num font-medium text-slate-900">
                        {frNum(r.cop, 2)}
                        {r.entry.cop_aff !== null && (
                          <span className="ml-1 text-[11px] text-slate-400">
                            ({frNum(r.entry.cop_aff, 1)})
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num text-slate-700">
                        {r.entry.edf_kwh !== null ? `${frNum(r.entry.edf_kwh, 2)}` : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono-num font-semibold text-slate-900">
                        {r.depense !== null ? `${frNum(r.depense, 2)} €` : '–'}
                      </td>
                      <td
                        className={`px-3 py-2.5 text-right font-mono-num font-medium ${
                          r.eco_n1 === null
                            ? 'text-slate-400'
                            : r.eco_n1 >= 0
                            ? 'text-emerald-700'
                            : 'text-red-700'
                        }`}
                      >
                        {r.eco_n1 !== null ? `${frNum(r.eco_n1, 2, true)} €` : '–'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 max-w-[200px] truncate">
                        {ecs ? `ECS ${ecs}` : r.entry.remarque || '–'}
                      </td>
                      {!readOnly && (
                        <td
                          className="px-4 py-2.5 text-right whitespace-nowrap"
                          onClick={(ev) => ev.stopPropagation()}
                        >
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => onEditDay(r.date)}
                              className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 transition-colors"
                              title="Modifier cette journée"
                              aria-label="Modifier"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeleteDay(r.date)}
                              className="rounded p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700 transition-colors"
                              title="Supprimer cette journée"
                              aria-label="Supprimer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

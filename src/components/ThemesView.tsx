import React from 'react';
import { Check, Contrast, Moon, Palette, Sun } from 'lucide-react';
import { ThemeMode } from '../types/pac';

interface ThemesViewProps {
  theme: ThemeMode;
  onChangeTheme: (theme: ThemeMode) => void;
}

const THEME_OPTIONS: Array<{
  id: ThemeMode;
  name: string;
  subtitle: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  preview: {
    canvas: string;
    card: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    bar2: string;
  };
}> = [
  {
    id: 'light',
    name: 'Clair',
    subtitle: 'Lumineux & net',
    description:
      'Fond blanc pur et contraste maximal, idéal en plein jour ou dans une pièce très éclairée.',
    icon: Sun,
    preview: {
      canvas: '#f8fafc',
      card: '#ffffff',
      border: '#e2e8f0',
      text: '#0f172a',
      muted: '#64748b',
      accent: '#0f766e',
      bar2: '#0284c7',
    },
  },
  {
    id: 'medium',
    name: 'Médium',
    subtitle: 'Doux & anti-éblouissement',
    description:
      'Teinte gris-ardoise mat qui supprime la brillance du blanc tout en gardant une lecture très claire.',
    icon: Contrast,
    preview: {
      canvas: '#d6dde6',
      card: '#e6ebf1',
      border: '#bec9d6',
      text: '#0f172a',
      muted: '#475569',
      accent: '#0f766e',
      bar2: '#0369a1',
    },
  },
  {
    id: 'dark',
    name: 'Dark',
    subtitle: 'Sombre & reposant',
    description:
      'Fond charbon profond avec accents lumineux pour consulter vos relevés le soir sans fatigue visuelle.',
    icon: Moon,
    preview: {
      canvas: '#0b1117',
      card: '#131c26',
      border: '#273649',
      text: '#f1f5f9',
      muted: '#94a3b8',
      accent: '#2dd4bf',
      bar2: '#38bdf8',
    },
  },
];

export function ThemesView({ theme, onChangeTheme }: ThemesViewProps) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
          <div>
            <h2 className="font-display text-lg font-semibold text-slate-900 flex items-center gap-2">
              <Palette className="h-5 w-5 text-teal-700" />
              Apparence &amp; Thèmes
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Choisissez la luminosité de Suivi PAC (Clair, Médium ou Dark). Votre choix est mémorisé sur cet appareil et s’applique aussi aux graphiques et à l’aperçu Android 16.
            </p>
          </div>
          <span className="text-xs font-medium text-slate-600">
            Thème actif :{' '}
            <strong className="text-slate-900">
              {THEME_OPTIONS.find((t) => t.id === theme)?.name}
            </strong>
          </span>
        </div>

        <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-5">
          {THEME_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => onChangeTheme(opt.id)}
                className={`text-left rounded-2xl border p-4 transition-all ${
                  active
                    ? 'border-teal-700 ring-2 ring-teal-700/25 bg-slate-50/70'
                    : 'border-slate-200 bg-white hover:bg-slate-50/70'
                }`}
              >
                {/* Mini aperçu visuel de la palette */}
                <div
                  className="rounded-xl p-3.5 border mb-4"
                  style={{
                    backgroundColor: opt.preview.canvas,
                    borderColor: opt.preview.border,
                  }}
                >
                  <div
                    className="rounded-lg p-3 border space-y-2.5"
                    style={{
                      backgroundColor: opt.preview.card,
                      borderColor: opt.preview.border,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <span
                        className="text-[11px] font-bold"
                        style={{ color: opt.preview.text }}
                      >
                        6,17 €
                      </span>
                      <span
                        className="text-[10px] font-medium"
                        style={{ color: opt.preview.muted }}
                      >
                        COP 4,67
                      </span>
                    </div>
                    <div className="flex items-end gap-1.5 h-8 pt-1">
                      <span
                        className="w-4 rounded-xs"
                        style={{ height: '42%', backgroundColor: opt.preview.accent }}
                      />
                      <span
                        className="w-4 rounded-xs"
                        style={{ height: '92%', backgroundColor: opt.preview.bar2 }}
                      />
                      <span
                        className="w-4 rounded-xs ml-1"
                        style={{ height: '42%', backgroundColor: opt.preview.accent }}
                      />
                      <span
                        className="w-4 rounded-xs"
                        style={{ height: '76%', backgroundColor: opt.preview.bar2 }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-teal-700 shrink-0" />
                    <span className="font-display text-base font-semibold text-slate-900">
                      {opt.name}
                    </span>
                  </div>
                  {active && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-700 px-2.5 py-0.5 text-[11px] font-medium text-white">
                      <Check className="h-3 w-3" />
                      Actif
                    </span>
                  )}
                </div>

                <div className="mt-1 text-xs font-medium text-teal-700">
                  {opt.subtitle}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  {opt.description}
                </p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

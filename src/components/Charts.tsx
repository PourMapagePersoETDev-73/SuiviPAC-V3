import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ComputedDay, PacModel } from '../types/pac';
import { fmtShortDateFr, frNum } from '../lib/pacEngine';

const COLORS = {
  pac: 'var(--chart-pac, #0F766E)',       // Deep Teal (This year / PAC)
  ref: 'var(--chart-ref, #0284C7)',       // Sky Blue (N-1 reference)
  good: 'var(--chart-good, #16A34A)',     // Emerald Green (Savings / Target)
  bad: 'var(--chart-bad, #DC2626)',       // Crimson (Over / COP affiché)
  warn: 'var(--chart-warn, #D97706)',     // Amber (Rentabilité / Threshold)
  gaz: 'var(--chart-gaz, #EA580C)',       // Orange (Gaz N-1)
  navy: 'var(--chart-navy, #0F172A)',     // Primary text/ink
  grid: 'var(--chart-grid, #E2E8F0)',
  axisText: 'var(--chart-axis, #64748B)',
  faint: 'var(--chart-faint, #94A3B8)',
  track: 'var(--chart-track, #E2E8F0)',
  dotStroke: 'var(--chart-dot-stroke, #FFFFFF)',
};

function niceMax(val: number, fallback = 10): number {
  if (!Number.isFinite(val) || val <= 0) return fallback;
  return val * 1.12;
}

function niceMin(val: number): number {
  if (!Number.isFinite(val) || val >= 0) return 0;
  return val * 1.12;
}

interface TooltipState {
  x: number;
  y: number;
  title: string;
  lines: Array<{ label: string; value: string; color?: string }>;
}

function ChartTooltip({ tip, width }: { tip: TooltipState | null; width: number }) {
  if (!tip) return null;
  const flipLeft = tip.x > width * 0.62;
  return (
    <div
      className="pointer-events-none absolute z-20 rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs shadow-sm backdrop-blur-sm"
      style={{
        top: Math.max(8, tip.y - 12),
        left: flipLeft ? undefined : Math.min(width - 170, tip.x + 12),
        right: flipLeft ? Math.max(8, width - tip.x + 12) : undefined,
      }}
    >
      <div className="font-semibold text-slate-900 mb-1">{tip.title}</div>
      <div className="space-y-0.5">
        {tip.lines.map((l, idx) => (
          <div key={idx} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-slate-600">
              {l.color && (
                <span
                  className="inline-block h-2 w-2 rounded-xs shrink-0"
                  style={{ backgroundColor: l.color }}
                />
              )}
              {l.label}
            </span>
            <span className="font-mono-num font-semibold text-slate-900">{l.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 0A. DayComparisonChart : Aujourd'hui (EDF) vs N-1 / N-2 / N-3 / Moyenne
 * -------------------------------------------------------------------------- */
export function DayComparisonChart({
  day,
  model,
}: {
  day: ComputedDay | null;
  model: PacModel;
}) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const W = 420;
  const H = 250;
  const m = { l: 38, r: 10, t: 22, b: 30 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  if (!day || day.depense === null) {
    return (
      <div className="flex h-[255px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
        Saisissez l’énergie EDF du jour pour afficher la comparaison.
      </div>
    );
  }

  const hasRefs = day.refs.some((x) => x !== null) || day.ref_mean !== null;

  // Fallback if N-1 references haven't been imported yet: compare with user's period average
  const validDays = model.days.filter((d) => d.depense !== null);
  const avgSelf =
    validDays.length > 0
      ? validDays.reduce((s, d) => s + (d.depense || 0), 0) / validDays.length
      : null;

  const items = hasRefs
    ? [
        { label: 'N-1', ref: day.refs[0] },
        { label: 'N-2', ref: day.refs[1] },
        { label: 'N-3', ref: day.refs[2] },
        { label: 'Moyenne', ref: day.ref_mean },
      ]
    : [
        { label: 'Jour saisi', ref: null },
        { label: 'Moy. période', ref: avgSelf },
      ];

  const allVals = [
    day.depense,
    ...items.map((it) => it.ref).filter((x): x is number => x !== null),
  ];
  const yMax = niceMax(Math.max(...allVals), 10);
  const yPos = (v: number) => m.t + ph - (v / yMax) * ph;
  const groupW = pw / items.length;
  const barW = Math.min(40, groupW * 0.36);

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2.5 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.pac }} />
          Aujourd’hui (EDF)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.ref }} />
          {hasRefs ? 'Référence (gaz + élec)' : 'Moyenne période EDF'}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[255px] overflow-visible">
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMax * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} strokeWidth={1} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, yMax < 10 ? 1 : 0)}
              </text>
            </g>
          );
        })}

        {items.map((it, i) => {
          const cx = m.l + groupW * (i + 0.5);
          const showTodayBar = hasRefs || i === 0;
          const todayH = Math.max(0, yPos(0) - yPos(day.depense!));
          const refH = it.ref !== null ? Math.max(0, yPos(0) - yPos(it.ref)) : 0;

          return (
            <g
              key={it.label}
              onMouseMove={(ev) => {
                const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: ((cx - m.l) / pw) * rect.width,
                  y: 28,
                  title: it.label,
                  lines: [
                    { label: 'Aujourd’hui EDF', value: `${frNum(day.depense, 2)} €`, color: COLORS.pac },
                    {
                      label: hasRefs ? 'Réf. gaz+élec' : 'Moy. EDF',
                      value: it.ref !== null ? `${frNum(it.ref, 2)} €` : 'n/d',
                      color: COLORS.ref,
                    },
                  ],
                });
              }}
              className="cursor-pointer"
            >
              {showTodayBar && (
                <>
                  <rect
                    x={hasRefs ? cx - barW - 2 : cx - barW / 2}
                    y={yPos(day.depense!)}
                    width={barW}
                    height={todayH}
                    rx={3}
                    fill={COLORS.pac}
                  />
                  <text
                    x={hasRefs ? cx - barW / 2 - 2 : cx}
                    y={yPos(day.depense!) - 5}
                    textAnchor="middle"
                    fontSize={11}
                    fontWeight={600}
                    fill={COLORS.pac}
                    className="font-mono-num"
                  >
                    {frNum(day.depense, 2)}
                  </text>
                </>
              )}

              {it.ref !== null ? (
                <>
                  <rect
                    x={hasRefs ? cx + 2 : cx - barW / 2}
                    y={yPos(it.ref)}
                    width={barW}
                    height={refH}
                    rx={3}
                    fill={COLORS.ref}
                  />
                  <text
                    x={hasRefs ? cx + barW / 2 + 2 : cx}
                    y={yPos(it.ref) - 5}
                    textAnchor="middle"
                    fontSize={11}
                    fill={COLORS.navy}
                    className="font-mono-num"
                  >
                    {frNum(it.ref, 2)}
                  </text>
                </>
              ) : (
                hasRefs && (
                  <text
                    x={cx + barW / 2 + 2}
                    y={yPos(0) - 5}
                    textAnchor="middle"
                    fontSize={10}
                    fill={COLORS.faint}
                  >
                    n/d
                  </text>
                )
              )}

              <text
                x={cx}
                y={H - 8}
                textAnchor="middle"
                fontSize={11.5}
                fill={COLORS.navy}
                fontWeight={500}
              >
                {it.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={420} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 0B. AnnualSavingsGauge : Demi-anneau objectif économies de l'année
 * -------------------------------------------------------------------------- */
export function AnnualSavingsGauge({
  value,
  target,
  fallbackSpend,
}: {
  value: number | null;
  target: number;
  fallbackSpend: number;
}) {
  const hasSavings = value !== null;
  const frac = hasSavings && target > 0 ? Math.max(0, Math.min(1, value / target)) : 0;
  const r = 74;
  const cx = 110;
  const cy = 98;
  const circ = Math.PI * r;
  const dashOffset = circ * (1 - frac);

  return (
    <div className="flex flex-col items-center justify-center py-2">
      <svg viewBox="0 0 220 132" className="w-full max-w-[240px] h-[146px]">
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={COLORS.track}
          strokeWidth={18}
          strokeLinecap="round"
        />
        {hasSavings && (
          <motion.path
            d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
            fill="none"
            stroke={frac >= 1 ? COLORS.good : value >= 0 ? COLORS.pac : COLORS.bad}
            strokeWidth={18}
            strokeLinecap="round"
            strokeDasharray={circ}
            initial={{ strokeDashoffset: circ }}
            animate={{ strokeDashoffset: dashOffset }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          />
        )}
        <text
          x={cx}
          y={cy - 14}
          textAnchor="middle"
          fontSize={22}
          fontWeight={700}
          fill={
            hasSavings
              ? value >= 0
                ? COLORS.good
                : COLORS.bad
              : COLORS.navy
          }
          className="font-mono-num"
        >
          {hasSavings ? `${frNum(value, 0, true)} €` : `${frNum(fallbackSpend, 0)} €`}
        </text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={11} fill={COLORS.axisText}>
          {hasSavings
            ? `objectif ${frNum(target, 0)} € (${frNum(frac * 100, 0)} %)`
            : `EDF cumulé (réf. N-1 requise)`}
        </text>
      </svg>
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 1. CumulativeSpendChart : Trajectoire annuelle dépense cumulée
 * -------------------------------------------------------------------------- */
export function CumulativeSpendChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const tj = model.traj;
  const hasN1 = tj.some((t) => t.n1 > 0);
  const hasReel = tj.some((t) => t.reel !== null);

  if (!hasReel && !hasN1) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
        Aucune donnée disponible sur l’année de chauffage.
      </div>
    );
  }

  // If no N-1 curve yet, plot only entered days so chart fills cleanly
  const points = hasN1
    ? tj
    : model.hy_days.reduce<Array<{ date: string; n1: number; obj: number; reel: number | null }>>(
        (acc, r) => {
          const prev = acc.length ? acc[acc.length - 1].reel || 0 : 0;
          acc.push({
            date: r.date,
            n1: 0,
            obj: 0,
            reel: prev + (r.depense || 0),
          });
          return acc;
        },
        []
      );

  const W = 540;
  const H = 240;
  const m = { l: 48, r: 16, t: 20, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const allVals = points.flatMap((p) => [p.n1, p.obj, p.reel ?? 0]);
  const yMax = niceMax(Math.max(...allVals), 100);
  const xPos = (i: number) => m.l + (points.length > 1 ? (i / (points.length - 1)) * pw : pw / 2);
  const yPos = (v: number) => m.t + ph - (v / yMax) * ph;

  const buildPath = (vals: (number | null)[]) => {
    let d = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v === null) return;
      const cmd = started ? 'L' : 'M';
      d += `${cmd}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  const step = Math.max(1, Math.floor(points.length / 6));

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {hasN1 && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.ref }} />
              N-1 (gaz + élec)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 border-b-2 border-dashed"
                style={{ borderColor: COLORS.good }}
              />
              Objectif -{frNum(model.kpi.obj_pct * 100, 0)} %
            </span>
          </>
        )}
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.pac }} />
          Cette année (élec)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[230px]"
        onMouseMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const relX = ((ev.clientX - rect.left) / rect.width) * W;
          const idx = Math.max(
            0,
            Math.min(points.length - 1, Math.round(((relX - m.l) / pw) * (points.length - 1)))
          );
          const pt = points[idx];
          if (!pt) return;
          setTip({
            x: (xPos(idx) / W) * rect.width,
            y: 26,
            title: fmtShortDateFr(pt.date),
            lines: [
              ...(hasN1
                ? [
                    { label: 'N-1 cumulé', value: `${frNum(pt.n1, 0)} €`, color: COLORS.ref },
                    { label: 'Objectif', value: `${frNum(pt.obj, 0)} €`, color: COLORS.good },
                  ]
                : []),
              {
                label: 'Cette année',
                value: pt.reel !== null ? `${frNum(pt.reel, 0)} €` : '–',
                color: COLORS.pac,
              },
            ],
          });
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMax * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, 0)} €
              </text>
            </g>
          );
        })}

        {hasN1 && (
          <>
            <motion.path
              d={buildPath(points.map((p) => p.n1))}
              fill="none"
              stroke={COLORS.ref}
              strokeWidth={2}
              initial={{ pathLength: 0, opacity: 0.4 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
            />
            <motion.path
              d={buildPath(points.map((p) => p.obj))}
              fill="none"
              stroke={COLORS.good}
              strokeWidth={1.6}
              strokeDasharray="5 4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.35, delay: 0.1 }}
            />
          </>
        )}
        <motion.path
          d={buildPath(points.map((p) => p.reel))}
          fill="none"
          stroke={COLORS.pac}
          strokeWidth={2.6}
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />

        {points.map((p, i) =>
          i % step === 0 || i === points.length - 1 ? (
            <text
              key={p.date}
              x={xPos(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.axisText}
            >
              {fmtShortDateFr(p.date)}
            </text>
          ) : null
        )}
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 2. CumulativeSavingsChart : Économie cumulée vs N-1 (€)
 * -------------------------------------------------------------------------- */
export function CumulativeSavingsChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const dd = model.hy_days.filter((r) => r.cumul !== null);

  if (!dd.length) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 text-center text-sm text-slate-500">
        Importez votre fichier Excel (ou renseignez les factures N-1) pour calculer la courbe d’économie cumulée.
      </div>
    );
  }

  const W = 540;
  const H = 240;
  const m = { l: 48, r: 16, t: 20, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const objEur = model.kpi.obj_eur;

  const vals = dd.map((r) => r.cumul!);
  const yMin = niceMin(Math.min(0, ...vals));
  const yMax = niceMax(Math.max(objEur, ...vals), 100);
  const xPos = (i: number) => m.l + (dd.length > 1 ? (i / (dd.length - 1)) * pw : pw / 2);
  const yPos = (v: number) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;

  const lineD = dd
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${xPos(i).toFixed(1)},${yPos(r.cumul!).toFixed(1)}`)
    .join(' ');
  const areaD = `${lineD} L${xPos(dd.length - 1).toFixed(1)},${yPos(0).toFixed(1)} L${xPos(0).toFixed(
    1
  )},${yPos(0).toFixed(1)} Z`;

  const step = Math.max(1, Math.floor(dd.length / 6));

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.good }} />
          Économie cumulée
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-b-2 border-dashed" style={{ borderColor: COLORS.warn }} />
          Objectif {frNum(objEur, 0)} €
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-[230px]"
        onMouseMove={(ev) => {
          const rect = ev.currentTarget.getBoundingClientRect();
          const relX = ((ev.clientX - rect.left) / rect.width) * W;
          const idx = Math.max(
            0,
            Math.min(dd.length - 1, Math.round(((relX - m.l) / pw) * (dd.length - 1)))
          );
          const r = dd[idx];
          if (!r) return;
          setTip({
            x: (xPos(idx) / W) * rect.width,
            y: 26,
            title: fmtShortDateFr(r.date),
            lines: [
              { label: 'Économie cumulée', value: `${frNum(r.cumul, 1, true)} €`, color: COLORS.good },
              { label: 'Objectif annuel', value: `${frNum(objEur, 0)} €`, color: COLORS.warn },
            ],
          });
        }}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMin + (yMax - yMin) * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, 0)} €
              </text>
            </g>
          );
        })}

        <motion.path
          d={areaD}
          fill={COLORS.good}
          fillOpacity={0.14}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d={lineD}
          fill="none"
          stroke={COLORS.good}
          strokeWidth={2.4}
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
        <line
          x1={m.l}
          x2={W - m.r}
          y1={yPos(objEur)}
          y2={yPos(objEur)}
          stroke={COLORS.warn}
          strokeWidth={1.6}
          strokeDasharray="5 4"
        />

        {dd.map((r, i) =>
          i % step === 0 || i === dd.length - 1 ? (
            <text
              key={r.date}
              x={xPos(i)}
              y={H - 8}
              textAnchor="middle"
              fontSize={10}
              fill={COLORS.axisText}
            >
              {fmtShortDateFr(r.date)}
            </text>
          ) : null
        )}
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 3. MonthlySavingsChart : Économie par mois vs N-1 (ou Dépense EDF mensuelle si pas de réf)
 * -------------------------------------------------------------------------- */
export function MonthlySavingsChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const em = model.months.filter((m) => m.eco !== null);
  const useSavings = em.length > 0;
  const rows = useSavings ? em : model.months;

  if (!rows.length) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
        Aucun mois saisi sur l’année de chauffage.
      </div>
    );
  }

  const W = 540;
  const H = 240;
  const m = { l: 48, r: 16, t: 22, b: 36 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const vals = rows.map((r) => (useSavings ? r.eco! : r.reel));
  const yMin = niceMin(Math.min(0, ...vals));
  const yMax = niceMax(Math.max(0, ...vals), 20);
  const yPos = (v: number) => m.t + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const groupW = pw / rows.length;
  const barW = Math.min(48, groupW * 0.62);

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        {useSavings ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.good }} />
              Gain mensuel
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.bad }} />
              Surcoût
            </span>
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.pac }} />
            Dépense EDF mensuelle (réf. N-1 non importée)
          </span>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[230px]">
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMin + (yMax - yMin) * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, 0)} €
              </text>
            </g>
          );
        })}

        <line x1={m.l} x2={W - m.r} y1={yPos(0)} y2={yPos(0)} stroke={COLORS.faint} strokeWidth={1} />

        {rows.map((r, i) => {
          const v = useSavings ? r.eco! : r.reel;
          const cx = m.l + groupW * (i + 0.5);
          const y0 = yPos(0);
          const yv = yPos(v);
          const color = useSavings ? (v >= 0 ? COLORS.good : COLORS.bad) : COLORS.pac;

          return (
            <g
              key={r.label}
              className="cursor-pointer"
              onMouseMove={(ev) => {
                const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: (cx / W) * rect.width,
                  y: 26,
                  title: `${r.label} (${r.jours}/${r.jours_mois} j)`,
                  lines: [
                    { label: 'Dépense EDF', value: `${frNum(r.reel, 1)} €`, color: COLORS.pac },
                    ...(r.ref_n1 !== null
                      ? [{ label: 'Réf. N-1', value: `${frNum(r.ref_n1, 1)} €`, color: COLORS.ref }]
                      : []),
                    ...(r.eco !== null
                      ? [{ label: 'Économie', value: `${frNum(r.eco, 1, true)} €`, color }]
                      : []),
                  ],
                });
              }}
            >
              <motion.rect
                x={cx - barW / 2}
                y={Math.min(y0, yv)}
                width={barW}
                height={Math.max(2, Math.abs(yv - y0))}
                rx={3}
                fill={color}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${y0}px` }}
                transition={{ duration: 0.32, delay: Math.min(i * 0.03, 0.2), ease: [0.16, 1, 0.3, 1] }}
              />
              <text
                x={cx}
                y={v >= 0 ? yv - 5 : yv + 12}
                textAnchor="middle"
                fontSize={10}
                fontWeight={600}
                fill={COLORS.navy}
                className="font-mono-num"
              >
                {useSavings ? `${frNum(v, 0, true)} €` : `${frNum(v, 0)} €`}
              </text>
              <text x={cx} y={H - 18} textAnchor="middle" fontSize={10} fill={COLORS.navy}>
                {r.label}
              </text>
              {r.partiel && (
                <text x={cx} y={H - 6} textAnchor="middle" fontSize={9} fill={COLORS.axisText}>
                  {r.jours}/{r.jours_mois} j
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 4. HeatingYearChart : Année de chauffage Oct->Sept (Gaz N-1, Élec N-1, Total N-1, Élec PAC)
 * -------------------------------------------------------------------------- */
export function HeatingYearChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const yn = model.year_n1;
  if (!yn) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 px-6 text-center text-sm text-slate-500">
        Tableau mensuel « Ref N-1 » non renseigné. Importez votre fichier Excel ou saisissez vos factures N-1 dans Paramètres.
      </div>
    );
  }

  const order = [10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const hy0Year = Number(model.kpi.hy0.slice(0, 4));
  const monthly = new Map<number, number>();
  for (const m of model.months) {
    if (!(m.y === hy0Year && m.m === 9)) {
      monthly.set(m.m, m.reel);
    }
  }

  const W = 540;
  const H = 240;
  const m = { l: 48, r: 14, t: 20, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const totals = yn.labels.map((_, i) => (yn.gaz[i] || 0) + (yn.elec[i] || 0));
  const pacVals = order.map((mn) => monthly.get(mn) ?? null);
  const allVals = [
    ...totals,
    ...pacVals.filter((x): x is number => x !== null),
  ];
  const yMax = niceMax(Math.max(...allVals), 50);
  const yPos = (v: number) => m.t + ph - (v / yMax) * ph;
  const groupW = pw / 12;
  const barW = Math.min(14, groupW * 0.34);

  const buildLine = (vals: (number | null)[]) => {
    let d = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v === null) return;
      const cx = m.l + groupW * (i + 0.5);
      d += `${started ? 'L' : 'M'}${cx.toFixed(1)},${yPos(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.gaz }} />
          Gaz N-1
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.ref }} />
          Élec N-1
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.navy }} />
          Total N-1
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.pac }} />
          Élec PAC (réel)
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[230px]">
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMax * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, 0)} €
              </text>
            </g>
          );
        })}

        {yn.labels.map((lab, i) => {
          const cx = m.l + groupW * (i + 0.5);
          const g = yn.gaz[i] || 0;
          const e = yn.elec[i] || 0;
          const p = pacVals[i];

          return (
            <g
              key={lab}
              className="cursor-pointer"
              onMouseMove={(ev) => {
                const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: (cx / W) * rect.width,
                  y: 26,
                  title: lab,
                  lines: [
                    { label: 'Gaz N-1', value: `${frNum(g, 0)} €`, color: COLORS.gaz },
                    { label: 'Élec N-1', value: `${frNum(e, 0)} €`, color: COLORS.ref },
                    { label: 'Total N-1', value: `${frNum(g + e, 0)} €`, color: COLORS.navy },
                    {
                      label: 'Élec PAC (réel)',
                      value: p !== null ? `${frNum(p, 0)} €` : '–',
                      color: COLORS.pac,
                    },
                  ],
                });
              }}
            >
              <motion.rect
                x={cx - barW - 1}
                y={yPos(g)}
                width={barW}
                height={Math.max(0, yPos(0) - yPos(g))}
                rx={2}
                fill={COLORS.gaz}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx - barW * 0.5 - 1}px ${yPos(0)}px` }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.02, 0.25), ease: [0.16, 1, 0.3, 1] }}
              />
              <motion.rect
                x={cx + 1}
                y={yPos(e)}
                width={barW}
                height={Math.max(0, yPos(0) - yPos(e))}
                rx={2}
                fill={COLORS.ref}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx + 1 + barW * 0.5}px ${yPos(0)}px` }}
                transition={{ duration: 0.35, delay: Math.min(i * 0.02 + 0.03, 0.28), ease: [0.16, 1, 0.3, 1] }}
              />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill={COLORS.axisText}>
                {lab}
              </text>
            </g>
          );
        })}

        <motion.path
          d={buildLine(totals)}
          fill="none"
          stroke={COLORS.navy}
          strokeWidth={1.6}
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d={buildLine(pacVals)}
          fill="none"
          stroke={COLORS.pac}
          strokeWidth={2.5}
          initial={{ pathLength: 0, opacity: 0.4 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}
        />

        {pacVals.map((v, i) =>
          v !== null ? (
            <circle
              key={i}
              cx={m.l + groupW * (i + 0.5)}
              cy={yPos(v)}
              r={3.5}
              fill={COLORS.pac}
              stroke={COLORS.dotStroke}
              strokeWidth={1.2}
            />
          ) : null
        )}
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 5. DailySpendChart : Dépense du jour (EDF) vs N-1 et objectif (60 derniers jours)
 * -------------------------------------------------------------------------- */
export function DailySpendChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const dk = model.hy_days.filter((r) => r.depense !== null).slice(-60);

  if (!dk.length) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
        Aucune dépense EDF saisie.
      </div>
    );
  }

  const W = 540;
  const H = 240;
  const m = { l: 42, r: 14, t: 20, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const objPct = model.kpi.obj_pct;

  const allVals = dk.flatMap((r) => [r.depense!, r.ref_n1 ?? 0]);
  const yMax = niceMax(Math.max(...allVals), 10);
  const yPos = (v: number) => m.t + ph - (v / yMax) * ph;
  const slotW = pw / dk.length;
  const barW = Math.max(2.5, slotW * 0.65);

  const hasN1 = dk.some((r) => r.ref_n1 !== null);
  const buildLine = (vals: (number | null)[]) => {
    let d = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v === null) return;
      const cx = m.l + slotW * (i + 0.5);
      d += `${started ? 'L' : 'M'}${cx.toFixed(1)},${yPos(v).toFixed(1)} `;
      started = true;
    });
    return d;
  };

  const step = Math.max(1, Math.floor(dk.length / 7));

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.pac }} />
          EDF du jour
        </span>
        {hasN1 && (
          <>
            <span className="flex items-center gap-1.5">
              <span className="h-0.5 w-4" style={{ backgroundColor: COLORS.ref }} />
              N-1 (gaz + élec)
            </span>
            <span className="flex items-center gap-1.5">
              <span
                className="h-0.5 w-4 border-b-2 border-dashed"
                style={{ borderColor: COLORS.good }}
              />
              Objectif -{frNum(objPct * 100, 0)} %
            </span>
          </>
        )}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[230px]">
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMax * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, yMax < 10 ? 1 : 0)} €
              </text>
            </g>
          );
        })}

        {dk.map((r, i) => {
          const cx = m.l + slotW * (i + 0.5);
          return (
            <g
              key={r.date}
              className="cursor-pointer"
              onMouseMove={(ev) => {
                const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: (cx / W) * rect.width,
                  y: 26,
                  title: fmtShortDateFr(r.date),
                  lines: [
                    { label: 'EDF du jour', value: `${frNum(r.depense, 2)} €`, color: COLORS.pac },
                    ...(r.ref_n1 !== null
                      ? [
                          { label: 'N-1 (gaz+élec)', value: `${frNum(r.ref_n1, 2)} €`, color: COLORS.ref },
                          {
                            label: 'Objectif',
                            value: `${frNum(r.ref_n1 * (1 - objPct), 2)} €`,
                            color: COLORS.good,
                          },
                        ]
                      : []),
                  ],
                });
              }}
            >
              <motion.rect
                x={cx - barW / 2}
                y={yPos(r.depense!)}
                width={barW}
                height={Math.max(1, yPos(0) - yPos(r.depense!))}
                rx={1.5}
                fill={COLORS.pac}
                fillOpacity={0.85}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${yPos(0)}px` }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.004, 0.2), ease: [0.16, 1, 0.3, 1] }}
              />
              {(i % step === 0 || i === dk.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill={COLORS.axisText}>
                  {fmtShortDateFr(r.date)}
                </text>
              )}
            </g>
          );
        })}

        {hasN1 && (
          <>
            <path d={buildLine(dk.map((r) => r.ref_n1))} fill="none" stroke={COLORS.ref} strokeWidth={1.8} />
            <path
              d={buildLine(dk.map((r) => (r.ref_n1 !== null ? r.ref_n1 * (1 - objPct) : null)))}
              fill="none"
              stroke={COLORS.good}
              strokeWidth={1.5}
              strokeDasharray="4 4"
            />
          </>
        )}
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 6. CopChart : COP réel du jour (barres) + COP affiché (points)
 * -------------------------------------------------------------------------- */
export function CopChart({ model }: { model: PacModel }) {
  const [tip, setTip] = useState<TooltipState | null>(null);
  const dc = model.days.filter((r) => r.cop !== null).slice(-60);

  if (!dc.length) {
    return (
      <div className="flex h-[230px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50/50 text-sm text-slate-500">
        Aucune mesure PAC conso/produite saisie.
      </div>
    );
  }

  const W = 540;
  const H = 240;
  const m = { l: 38, r: 14, t: 20, b: 28 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;

  const { cop_rentab, cop_cible } = model.kpi;
  const allVals = [
    cop_rentab,
    cop_cible,
    ...dc.flatMap((r) => [r.cop!, r.entry.cop_aff ?? 0]),
  ];
  const yMax = niceMax(Math.max(...allVals), 6);
  const yPos = (v: number) => m.t + ph - (v / yMax) * ph;
  const slotW = pw / dc.length;
  const barW = Math.max(2.5, slotW * 0.62);
  const step = Math.max(1, Math.floor(dc.length / 7));

  return (
    <div className="relative select-none" onMouseLeave={() => setTip(null)}>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-xs" style={{ backgroundColor: COLORS.ref }} />
          COP réel
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: COLORS.bad }} />
          COP affiché
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-b-2 border-dashed" style={{ borderColor: COLORS.warn }} />
          Rentabilité gaz ({frNum(cop_rentab, 2)})
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-0.5 w-4 border-b-2 border-dotted" style={{ borderColor: COLORS.good }} />
          Cible ({frNum(cop_cible, 2)})
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[230px]">
        {[0, 0.25, 0.5, 0.75, 1].map((t, idx) => {
          const val = yMax * t;
          const y = yPos(val);
          return (
            <g key={idx}>
              <line x1={m.l} x2={W - m.r} y1={y} y2={y} stroke={COLORS.grid} />
              <text
                x={m.l - 6}
                y={y + 3}
                textAnchor="end"
                fontSize={10}
                fill={COLORS.axisText}
                className="font-mono-num"
              >
                {frNum(val, 1)}
              </text>
            </g>
          );
        })}

        {dc.map((r, i) => {
          const cx = m.l + slotW * (i + 0.5);
          const aff = r.entry.cop_aff;

          return (
            <g
              key={r.date}
              className="cursor-pointer"
              onMouseMove={(ev) => {
                const rect = ev.currentTarget.ownerSVGElement?.getBoundingClientRect();
                if (!rect) return;
                setTip({
                  x: (cx / W) * rect.width,
                  y: 26,
                  title: fmtShortDateFr(r.date),
                  lines: [
                    { label: 'COP réel', value: frNum(r.cop, 2), color: COLORS.ref },
                    {
                      label: 'COP affiché',
                      value: aff !== null ? frNum(aff, 2) : '–',
                      color: COLORS.bad,
                    },
                    ...(r.entry.temp !== null
                      ? [{ label: 'Température', value: `${frNum(r.entry.temp, 1)} °C` }]
                      : []),
                  ],
                });
              }}
            >
              <motion.rect
                x={cx - barW / 2}
                y={yPos(r.cop!)}
                width={barW}
                height={Math.max(1, yPos(0) - yPos(r.cop!))}
                rx={1.5}
                fill={COLORS.ref}
                fillOpacity={0.85}
                initial={{ opacity: 0, scaleY: 0 }}
                animate={{ opacity: 1, scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${yPos(0)}px` }}
                transition={{ duration: 0.28, delay: Math.min(i * 0.004, 0.2), ease: [0.16, 1, 0.3, 1] }}
              />
              {aff !== null && (
                <circle cx={cx} cy={yPos(aff)} r={2.8} fill={COLORS.bad} stroke={COLORS.dotStroke} strokeWidth={0.8} />
              )}
              {(i % step === 0 || i === dc.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill={COLORS.axisText}>
                  {fmtShortDateFr(r.date)}
                </text>
              )}
            </g>
          );
        })}

        <line
          x1={m.l}
          x2={W - m.r}
          y1={yPos(cop_rentab)}
          y2={yPos(cop_rentab)}
          stroke={COLORS.warn}
          strokeWidth={1.5}
          strokeDasharray="4 4"
        />
        <line
          x1={m.l}
          x2={W - m.r}
          y1={yPos(cop_cible)}
          y2={yPos(cop_cible)}
          stroke={COLORS.good}
          strokeWidth={1.5}
          strokeDasharray="2 3"
        />
      </svg>
      <ChartTooltip tip={tip} width={540} />
    </div>
  );
}

/* --------------------------------------------------------------------------
 * 7. ConsumptionGauge : Jauge de progression par rapport à un objectif de consommation
 * -------------------------------------------------------------------------- */
export function ConsumptionGauge({
  actual,
  target,
  unit,
  label,
  periodLabel,
  daysCount,
  totalPeriodDays,
  projectedOverride,
  projectionLabel,
}: {
  actual: number;
  target: number;
  unit: string;
  label: string;
  periodLabel: string;
  daysCount: number;
  totalPeriodDays: number;
  projectedOverride?: number | null;
  projectionLabel?: string | null;
}) {
  const safeTarget = target > 0 ? target : 1;
  const rawRatio = actual / safeTarget;
  const clampedFrac = Math.max(0, Math.min(1, rawRatio));
  const pct = rawRatio * 100;

  const status: 'ok' | 'warn' | 'over' =
    rawRatio > 1 ? 'over' : rawRatio >= 0.8 ? 'warn' : 'ok';

  const strokeColor =
    status === 'over'
      ? COLORS.bad
      : status === 'warn'
      ? COLORS.warn
      : COLORS.good;

  const statusText =
    status === 'over'
      ? 'Objectif dépassé'
      : status === 'warn'
      ? 'Proche du plafond'
      : 'Dans l’objectif';

  const statusClass =
    status === 'over'
      ? 'text-red-700'
      : status === 'warn'
      ? 'text-amber-700'
      : 'text-emerald-700';

  const r = 92;
  const cx = 140;
  const cy = 122;
  const circ = Math.PI * r;
  const dashOffset = circ * (1 - clampedFrac);

  // Polar helper on upper semi-circle (180° left -> 0° right)
  const ptAt = (frac: number, radius: number) => {
    const rad = Math.PI * (1 - frac);
    return {
      x: cx + radius * Math.cos(rad),
      y: cy - radius * Math.sin(rad),
    };
  };

  const marker80In = ptAt(0.8, r - 11);
  const marker80Out = ptAt(0.8, r + 11);

  const decimals = unit === '€' ? 2 : 1;
  const remaining = target - actual;
  const dailyAvg = daysCount > 0 ? actual / daysCount : null;
  const projected =
    projectedOverride !== undefined
      ? projectedOverride
      : dailyAvg !== null && totalPeriodDays > 0
      ? dailyAvg * totalPeriodDays
      : null;

  return (
    <div className="flex flex-col items-center">
      <div className="text-center mb-1">
        <div className="text-xs font-medium text-slate-500">
          {label} · {periodLabel}
        </div>
        <div className={`mt-0.5 text-xs font-semibold ${statusClass}`}>
          {statusText} ({frNum(pct, 1)} %)
        </div>
      </div>

      <svg viewBox="0 0 280 154" className="w-full max-w-[300px] h-[168px]">
        {/* Track */}
        <path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={COLORS.track}
          strokeWidth={18}
          strokeLinecap="round"
        />

        {/* Progress arc */}
        <motion.path
          d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`}
          fill="none"
          stroke={strokeColor}
          strokeWidth={18}
          strokeLinecap="round"
          strokeDasharray={circ}
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: dashOffset }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        />

        {/* 80% warning tick */}
        <line
          x1={marker80In.x}
          y1={marker80In.y}
          x2={marker80Out.x}
          y2={marker80Out.y}
          stroke={COLORS.faint}
          strokeWidth={1.5}
          strokeDasharray="2 2"
        />

        {/* Current value marker dot sweeping along the arc */}
        <motion.g
          initial={{ rotate: 0 }}
          animate={{ rotate: clampedFrac * 180 }}
          style={{ transformOrigin: `${cx}px ${cy}px` }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <circle
            cx={cx - r}
            cy={cy}
            r={5.5}
            fill={COLORS.dotStroke}
            stroke={strokeColor}
            strokeWidth={3}
          />
        </motion.g>

        {/* Center figures */}
        <text
          x={cx}
          y={cy - 22}
          textAnchor="middle"
          fontSize={24}
          fontWeight={700}
          fill={COLORS.navy}
          className="font-mono-num"
        >
          {frNum(actual, decimals)} {unit}
        </text>
        <text
          x={cx}
          y={cy + 2}
          textAnchor="middle"
          fontSize={12}
          fill={COLORS.axisText}
          className="font-mono-num"
        >
          sur {frNum(target, 0)} {unit} ({frNum(pct, 0)} %)
        </text>

        {/* Scale labels */}
        <text x={cx - r} y={cy + 22} textAnchor="middle" fontSize={10} fill={COLORS.faint} className="font-mono-num">
          0
        </text>
        <text x={cx} y={cy - r - 14} textAnchor="middle" fontSize={10} fill={COLORS.faint} className="font-mono-num">
          50 %
        </text>
        <text x={cx + r} y={cy + 22} textAnchor="middle" fontSize={10} fill={COLORS.faint} className="font-mono-num">
          {frNum(target, 0)} {unit}
        </text>
      </svg>

      {/* Metrics row */}
      <div className="w-full grid grid-cols-3 gap-2 pt-3 border-t border-slate-100 text-center">
        <div>
          <div className="text-[11px] text-slate-500">
            {remaining >= 0 ? 'Marge restante' : 'Dépassement'}
          </div>
          <div
            className={`mt-0.5 text-sm font-semibold font-mono-num ${
              remaining >= 0 ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {remaining >= 0
              ? `${frNum(remaining, decimals)} ${unit}`
              : `+${frNum(Math.abs(remaining), decimals)} ${unit}`}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">Moyenne / jour</div>
          <div className="mt-0.5 text-sm font-semibold font-mono-num text-slate-900">
            {dailyAvg !== null ? `${frNum(dailyAvg, unit === '€' ? 2 : 1)} ${unit}` : '–'}
          </div>
        </div>
        <div>
          <div className="text-[11px] text-slate-500">
            {projectionLabel || 'Projection période'}
          </div>
          <div
            className={`mt-0.5 text-sm font-semibold font-mono-num ${
              projected !== null && projected > target
                ? 'text-red-700'
                : 'text-slate-900'
            }`}
          >
            {projected !== null ? `${frNum(projected, 0)} ${unit}` : '–'}
          </div>
        </div>
      </div>
    </div>
  );
}


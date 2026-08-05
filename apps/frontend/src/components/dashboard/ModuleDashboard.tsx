'use client';

import type { ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import type { Delta } from '@/lib/dashboard-delta';
import PageShell from '@/components/ui/compact/PageShell';
import { AttentionStrip, type AttentionItem } from './AttentionStrip';
import { DashboardHeader, RangeTabs, type DashboardRange } from './DashboardHeader';
import { HealthKpiTile } from './HealthKpiTile';

/**
 * Where the dashboard is mounted. `embedded` is a module Overview, under a
 * `ModuleHub` that already supplies the page shell and a header; `page` is
 * `/dashboard`, where the dashboard is the whole page.
 */
export type DashboardMount = 'page' | 'embedded';

export type KpiTileSpec = {
    key: string;
    title: string;
    value: string;
    delta: Delta;
    /** Sparkline series. Fewer than two points renders `note` instead. */
    points?: number[];
    note?: string;
};

/** A labelled band. Every dashboard is four of these in the same order. */
export function DashboardSection({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
    return (
        <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">{label}</p>
            {children}
        </section>
    );
}

const TILE_GRID = 'grid grid-cols-2 gap-2.5 xl:grid-cols-4';

/** The four-tile health band, with the skeleton it shows while the window loads. */
export function KpiTileGrid({
    tiles,
    loading,
    deltaContext,
}: Readonly<{
    tiles: KpiTileSpec[];
    loading: boolean;
    deltaContext: string;
}>) {
    if (loading) {
        return (
            <div className={TILE_GRID}>
                {Array.from({ length: 4 }).map((_, index) => (
                    <div
                        key={index}
                        className="animate-pulse rounded-xl border border-gray-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                    >
                        <div className="h-3 w-16 rounded bg-gray-200" />
                        <div className="mt-2 h-6 w-24 rounded bg-gray-200" />
                        <div className="mt-2 h-3 w-12 rounded bg-gray-200" />
                        <div className="mt-3 h-5 w-full rounded bg-gray-100" />
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className={TILE_GRID}>
            {tiles.map((tile) => (
                <HealthKpiTile
                    key={tile.key}
                    title={tile.title}
                    value={tile.value}
                    delta={tile.delta.label}
                    deltaPositive={tile.delta.positive}
                    // A dash is the absence of a comparison; "— vs last week" reads
                    // as though there were one.
                    deltaContext={tile.delta.label === '—' ? undefined : deltaContext}
                    points={tile.points ?? []}
                    note={tile.note}
                />
            ))}
        </div>
    );
}

/** The attention strip plus its skeleton. Empty is a message, not an empty row. */
export function AttentionSection({
    items,
    loading,
    label,
    allClearLabel,
}: Readonly<{
    items: AttentionItem[];
    loading: boolean;
    label: string;
    allClearLabel: string;
}>) {
    return (
        <DashboardSection label={label}>
            {loading ? (
                <div className={TILE_GRID}>
                    {Array.from({ length: 3 }).map((_, index) => (
                        <div
                            key={index}
                            className="h-16 animate-pulse rounded-xl border border-gray-100 bg-white p-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]"
                        />
                    ))}
                </div>
            ) : (
                <AttentionStrip items={items} allClearLabel={allClearLabel} />
            )}
        </DashboardSection>
    );
}

/**
 * The shell every module dashboard renders inside: the header (or, when embedded
 * under a module hub, the range switcher alone), the error banner, and the page
 * shell that only the standalone mount supplies.
 *
 * It holds no data. Each module's dashboard owns its endpoint and its panels and
 * hands the composed bands in as `children`.
 */
export default function ModuleDashboard({
    mount,
    greeting,
    tenantName,
    subtitle,
    range,
    onRangeChange,
    error,
    children,
}: Readonly<{
    mount: DashboardMount;
    greeting: string;
    tenantName: string;
    subtitle: string;
    range: DashboardRange;
    onRangeChange: (range: DashboardRange) => void;
    error?: string;
    children: ReactNode;
}>) {
    const { t } = useI18n();
    const copy = t.dashboardHome;
    const rangeLabels = { today: copy.rangeToday, week: copy.rangeWeek, month: copy.rangeMonth };

    const body = (
        <div className="space-y-4">
            {mount === 'page' ? (
                <DashboardHeader
                    greeting={greeting}
                    tenantName={tenantName}
                    subtitle={subtitle}
                    range={range}
                    onRangeChange={onRangeChange}
                    labels={rangeLabels}
                />
            ) : (
                // The hub header supplies everything but this one control.
                <div className="flex justify-end">
                    <RangeTabs range={range} onRangeChange={onRangeChange} labels={rangeLabels} />
                </div>
            )}

            {error ? (
                <div className="rounded-lg border border-amber-200 bg-warning-light px-3 py-2 text-xs font-semibold text-warning-text">
                    {error}
                </div>
            ) : null}

            {children}
        </div>
    );

    return mount === 'page' ? <PageShell maxWidth="full">{body}</PageShell> : body;
}

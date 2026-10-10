'use client';

import { formatBDT } from '@/lib/format';
import { formatMessage } from '@/lib/i18n';
import type { MessageDictionary } from '@/lib/localization/messages';
import { compactDensity } from '@/lib/ui/compact-density';
import type { PaymentKpis } from './payment-kpis';
import type { MoneyFlow, PartyPaymentsLabels } from './types';

/**
 * Categorical colours for the by-method bar, in order of size. A chart palette
 * (UI spec §2.7 "Charts"), not accents: bKash is not pink here, so the strip
 * stays in the one-accent system.
 */
const METHOD_COLORS = ['bg-blue-600', 'bg-emerald-500', 'bg-amber-500', 'bg-sky-400', 'bg-teal-600', 'bg-gray-400'];
const UNRECORDED_COLOR = 'bg-gray-300';

interface PaymentKpiStripProps {
    kpis: PaymentKpis;
    primary: MoneyFlow;
    labels: PartyPaymentsLabels;
    ui: MessageDictionary['partyPayments'];
}

function Tile({ label, value, tone, note, children }: {
    label: string;
    value: string;
    tone?: 'in' | 'out';
    note?: string;
    children?: React.ReactNode;
}) {
    const toneClass = tone === 'in' ? 'text-emerald-600' : tone === 'out' ? 'text-danger' : 'text-gray-900';
    return (
        <div className={`${compactDensity.cardFlat} min-w-0 border-gray-200`}>
            <p className={compactDensity.statLabel}>{label}</p>
            <p className={`text-lg font-bold tracking-tight tabular-nums ${toneClass}`}>{value}</p>
            {note ? <p className="text-[11px] text-gray-400">{note}</p> : null}
            {children}
        </div>
    );
}

/**
 * The period at a glance: money in and money out on their own tiles — never
 * netted into one green figure — plus discounts and the net, with the primary
 * direction split by payment method.
 */
/** The legend's longest list before the tail folds into "Other"; more wraps the tile to three lines. */
const LEGEND_MAX = 3;

export function PaymentKpiStrip({ kpis, primary, labels, ui }: PaymentKpiStripProps) {
    const primaryTotal = primary === 'receive' ? kpis.inTotal : kpis.outTotal;
    const entries = (count: number) => formatMessage(ui.entries, { count });
    const legend = kpis.byMethod.length > LEGEND_MAX
        ? [
            ...kpis.byMethod.slice(0, LEGEND_MAX - 1),
            { name: ui.otherMethods, amount: kpis.byMethod.slice(LEGEND_MAX - 1).reduce((sum, entry) => sum + entry.amount, 0), other: true },
        ]
        : kpis.byMethod;
    const colorOf = (entry: { name: string | null; other?: boolean }, index: number) => (
        entry.name === null ? UNRECORDED_COLOR : entry.other ? 'bg-gray-400' : METHOD_COLORS[index % METHOD_COLORS.length]
    );

    const methodBar = kpis.byMethod.length > 0 && primaryTotal > 0 ? (
        <div className="mt-2">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-gray-100" aria-hidden>
                {legend.map((entry, index) => (
                    <span
                        key={entry.name ?? '__none'}
                        className={colorOf(entry, index)}
                        style={{ width: `${(entry.amount / primaryTotal) * 100}%` }}
                    />
                ))}
            </div>
            <ul className="mt-1.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] text-gray-500">
                {legend.map((entry, index) => (
                    <li key={entry.name ?? '__none'} className="inline-flex items-center gap-1">
                        <span className={`inline-block h-2 w-2 rounded-sm ${colorOf(entry, index)}`} aria-hidden />
                        {entry.name ?? ui.methodNotRecorded}{' '}
                        <span className="tabular-nums text-gray-700">{formatBDT(entry.amount, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
                    </li>
                ))}
            </ul>
        </div>
    ) : null;

    const inTile = (
        <Tile key="in" label={labels.kpiIn} value={formatBDT(kpis.inTotal)} tone={primary === 'receive' ? 'in' : undefined} note={entries(kpis.inCount)}>
            {primary === 'receive' ? methodBar : null}
        </Tile>
    );
    const outTile = (
        // Paying a supplier is the page's ordinary business, not a warning.
        <Tile key="out" label={labels.kpiOut} value={formatBDT(kpis.outTotal)} tone={primary === 'pay' ? undefined : 'out'} note={entries(kpis.outCount)}>
            {primary === 'pay' ? methodBar : null}
        </Tile>
    );

    return (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label={labels.listTitle}>
            {primary === 'receive' ? [inTile, outTile] : [outTile, inTile]}
            <Tile label={labels.discount.label} value={formatBDT(kpis.discountTotal)} note={entries(kpis.discountCount)} />
            <Tile label={labels.kpiNet} value={formatBDT(kpis.net)} />
        </section>
    );
}

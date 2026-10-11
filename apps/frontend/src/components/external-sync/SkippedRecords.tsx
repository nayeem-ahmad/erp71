'use client';

import { Copy, Download } from 'lucide-react';
import { Button } from '@/components/ui';
import type { ExternalSyncRun, ExternalSyncWarning } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { toast } from '@/lib/toast';

/**
 * The records an import run could not bring across, each with the reason, as a
 * list to read and as plain text to copy or save. The run keeps every one of
 * these even when it trims its other notes.
 */

/** In the order the import runs its steps, so the report reads the same way. */
const GROUPS: Array<[entity: string, label: string]> = [
    ['PRODUCT', 'Products'],
    ['CUSTOMER', 'Customers'],
    ['SUPPLIER', 'Suppliers'],
    ['PURCHASE', 'Purchases'],
    ['SALE', 'Sales'],
    ['QUOTATION', 'Quotations'],
    ['CUSTOMER_PAYMENT', 'Customer payments'],
    ['SUPPLIER_PAYMENT', 'Supplier payments'],
    ['SALE_RETURN', 'Sale returns'],
];

export function skippedRecordsOf(run: ExternalSyncRun): ExternalSyncWarning[] {
    return (run.warnings ?? []).filter((warning) => warning.skipped);
}

function grouped(records: ExternalSyncWarning[]): Array<{ label: string; records: ExternalSyncWarning[] }> {
    const known = new Set(GROUPS.map(([entity]) => entity));
    const groups = GROUPS.map(([entity, label]) => ({ label, records: records.filter((r) => r.entity === entity) }));
    groups.push({ label: 'Other', records: records.filter((r) => !known.has(r.entity)) });
    return groups.filter((group) => group.records.length > 0);
}

/** Number · date · party · amount · lines — whichever the record has. */
function summary(record: ExternalSyncWarning): string {
    const s = record.skipped!;
    return [
        s.number ?? record.externalId,
        s.date,
        s.party,
        s.amount == null ? null : formatBDT(s.amount),
        s.lines == null ? null : `${s.lines} line${s.lines === 1 ? '' : 's'}`,
    ]
        .filter(Boolean)
        .join(' · ');
}

export function formatSkippedReport(run: ExternalSyncRun): string {
    const records = skippedRecordsOf(run);
    const lines = [
        `Skipped records — import of ${run.started_at.slice(0, 10)} (${run.window_from.slice(0, 10)} → ${run.window_to.slice(0, 10)})`,
        `${records.length} record${records.length === 1 ? ' was' : 's were'} not imported.`,
        '',
    ];
    for (const group of grouped(records)) {
        lines.push(`${group.label} — ${group.records.length}`);
        for (const record of group.records) {
            lines.push(`  ${summary(record)}`, `    ${record.message}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

export function SkippedRecordsPanel({ run }: Readonly<{ run: ExternalSyncRun }>) {
    const records = skippedRecordsOf(run);

    async function copy() {
        try {
            await navigator.clipboard.writeText(formatSkippedReport(run));
            toast.success('Skipped records copied');
        } catch {
            toast.error('Could not copy — use Download instead');
        }
    }

    function download() {
        const url = URL.createObjectURL(new Blob([formatSkippedReport(run)], { type: 'text/plain;charset=utf-8' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = `skipped-records-${run.started_at.slice(0, 10)}.txt`;
        link.click();
        URL.revokeObjectURL(url);
    }

    return (
        <div className="space-y-3 text-xs text-gray-600 bg-gray-50 rounded-md p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium text-gray-900">
                    {records.length} record{records.length === 1 ? ' was' : 's were'} not imported
                </p>
                <div className="flex gap-2">
                    <Button variant="secondary" icon={<Copy className="w-3.5 h-3.5" />} onClick={copy}>
                        Copy as text
                    </Button>
                    <Button variant="secondary" icon={<Download className="w-3.5 h-3.5" />} onClick={download}>
                        Download .txt
                    </Button>
                </div>
            </div>
            {grouped(records).map((group) => (
                <div key={group.label}>
                    <p className="font-medium text-gray-900">
                        {group.label} — {group.records.length}
                    </p>
                    <ul className="mt-1 space-y-1.5">
                        {group.records.map((record, index) => (
                            <li key={`${record.externalId}-${index}`}>
                                <span className="text-gray-900">{summary(record)}</span>
                                <span className="block text-gray-500">{record.message}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
        </div>
    );
}

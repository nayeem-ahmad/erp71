'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
    formatAuditInstant,
    type ActivityDetailsAuditView,
    type ActivityTextValue,
} from '@/lib/audit-description';
import { getActiveTimeZone } from '@/lib/format';
import { useI18n } from '@/lib/i18n';

/**
 * Before and after for one `crm.activity_details_updated` row.
 *
 * Strings are rendered as text nodes, so markup in a note stays characters.
 * A missing, truncated, or non-text value is labelled as such and is not
 * presented as recovered wording.
 */
export default function ActivityDetailsAuditPanel({ view }: { view: ActivityDetailsAuditView }) {
    const { t } = useI18n();
    const m = t.settings.audit.activityDetails;
    const [open, setOpen] = useState(false);
    const when = formatAuditInstant(view.createdAt, getActiveTimeZone());

    return (
        <div className="space-y-1">
            <p className="font-mono text-xs text-gray-600 break-all">{view.action}</p>
            <dl className="space-y-0.5 text-xs text-gray-500">
                <Identity label={m.activityId} value={view.entityId} missing={m.notRecorded} />
                <Identity label={m.auditId} value={view.auditId} missing={m.notRecorded} />
                <Identity label={m.when} value={when} missing={m.notRecorded} />
            </dl>
            <button
                type="button"
                onClick={() => setOpen((value) => !value)}
                aria-expanded={open}
                className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline min-h-touch md:min-h-0"
            >
                {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {m.title}
            </button>
            {open && (
                <div className="rounded-md border border-gray-200 bg-gray-50 p-2 space-y-2">
                    <p className="text-xs text-gray-500">{m.hint}</p>
                    {view.mode === 'truncated' && (
                        <p role="alert" className="text-xs text-amber-800">{m.truncated}</p>
                    )}
                    {view.mode === 'absent' && (
                        <p role="alert" className="text-xs text-amber-800">{m.absent}</p>
                    )}
                    {view.mode === 'changes' && view.fields.map((field) => (
                        <div key={field.field} className="space-y-1">
                            <p className="text-xs font-medium text-gray-700">{m.fields[field.field]}</p>
                            {field.recorded ? (
                                <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
                                    <ValueBox label={m.before} value={field.from} copy={m} testId={`activity-${field.field}-before`} />
                                    <ValueBox label={m.after} value={field.to} copy={m} testId={`activity-${field.field}-after`} />
                                </div>
                            ) : (
                                <p className="text-xs text-gray-500" data-testid={`activity-${field.field}-missing`}>
                                    {m.notRecorded}
                                </p>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function Identity({ label, value, missing }: { label: string; value: string | null; missing: string }) {
    return (
        <div className="flex gap-2">
            <dt className="shrink-0">{label}</dt>
            <dd className="min-w-0 break-all font-mono text-gray-700">{value ?? missing}</dd>
        </div>
    );
}

function ValueBox({
    label,
    value,
    copy,
    testId,
}: {
    label: string;
    value: ActivityTextValue;
    copy: {
        nullValue: string;
        emptyValue: string;
        notRecorded: string;
        notText: string;
    };
    testId: string;
}) {
    let body: string;
    if (value.kind === 'text') body = value.text ?? '';
    else if (value.kind === 'null') body = copy.nullValue;
    else if (value.kind === 'empty') body = copy.emptyValue;
    else if (value.kind === 'nontext') body = copy.notText;
    else body = copy.notRecorded;

    return (
        <div className="min-w-0">
            <p className="text-xs text-gray-500">{label}</p>
            <div
                data-testid={testId}
                data-kind={value.kind}
                className="mt-0.5 whitespace-pre-wrap break-words rounded border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800"
            >
                {body}
            </div>
        </div>
    );
}

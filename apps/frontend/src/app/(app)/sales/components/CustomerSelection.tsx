'use client';

import { useState, useEffect } from 'react';
import { UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import PartySearchSelect, {
    PartySummaryLine,
    type PartyOption,
} from '@/components/document-entry/PartySearchSelect';

/** A customer typed into the form but not saved yet — created with the document. */
export interface NewCustomerDraft {
    name: string;
    phone: string;
    email: string;
    address: string;
}

export const emptyCustomerDraft: NewCustomerDraft = {
    name: '',
    phone: '',
    email: '',
    address: '',
};

/** The `newCustomer` payload a document POST carries, or undefined when none. */
export function newCustomerPayload(draft: NewCustomerDraft | null) {
    if (!draft) return undefined;
    return {
        name: draft.name.trim(),
        phone: draft.phone.trim() || undefined,
        email: draft.email.trim() || undefined,
        address: draft.address.trim() || undefined,
    };
}

interface CustomerSelectionProps {
    customer: any;
    setCustomer: (customer: any) => void;
    readOnly?: boolean;
    /** Non-null while the form is capturing a customer that does not exist yet. */
    draft?: NewCustomerDraft | null;
    setDraft?: (draft: NewCustomerDraft | null) => void;
    /** Highlight the name box when a submit was rejected for missing it. */
    draftNameInvalid?: boolean;
}

const FIELD_CLASS = 'w-full border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent min-h-touch sm:min-h-0';

/**
 * The sale's customer picker: the shared party typeahead plus credit context,
 * and — where the parent passes draft state — an inline "new customer" form.
 * The draft is posted with the document (`newCustomer`), so nothing is created
 * until the sale, order or quote itself is.
 */
export default function CustomerSelection({
    customer,
    setCustomer,
    readOnly = false,
    draft = null,
    setDraft,
    draftNameInvalid = false,
}: CustomerSelectionProps) {
    const { t } = useI18n();
    const [customers, setCustomers] = useState<PartyOption[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Nothing to pick from when the sale is only being viewed.
        if (readOnly) return;

        let cancelled = false;
        setLoading(true);
        api.getCustomers()
            .then((data: PartyOption[]) => { if (!cancelled) setCustomers(data ?? []); })
            .catch((error: unknown) => console.error('Failed to load customers', error))
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, [readOnly]);

    const updateDraft = (patch: Partial<NewCustomerDraft>) =>
        setDraft?.({ ...(draft ?? emptyCustomerDraft), ...patch });

    if (draft && setDraft) {
        return (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {t.shared.newCustomer}
                    </span>
                    <button
                        type="button"
                        onClick={() => setDraft(null)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        <X className="w-3.5 h-3.5" />
                        {t.shared.useExisting}
                    </button>
                </div>
                <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    placeholder={t.shared.customerNamePlaceholder}
                    aria-label={t.shared.customerNamePlaceholder}
                    className={`${FIELD_CLASS} ${draftNameInvalid ? 'border-red-500' : ''}`}
                />
                <div className="grid grid-cols-2 gap-1.5">
                    <input
                        type="text"
                        value={draft.phone}
                        onChange={(e) => updateDraft({ phone: e.target.value })}
                        placeholder={t.common.phone}
                        aria-label={t.common.phone}
                        className={FIELD_CLASS}
                    />
                    <input
                        type="email"
                        value={draft.email}
                        onChange={(e) => updateDraft({ email: e.target.value })}
                        placeholder={t.common.email}
                        aria-label={t.common.email}
                        className={FIELD_CLASS}
                    />
                </div>
                <input
                    type="text"
                    value={draft.address}
                    onChange={(e) => updateDraft({ address: e.target.value })}
                    placeholder={t.common.address}
                    aria-label={t.common.address}
                    className={FIELD_CLASS}
                />
            </div>
        );
    }

    return (
        <PartySearchSelect
            parties={customers}
            loading={loading}
            selected={customer}
            onSelect={setCustomer}
            readOnly={readOnly}
            readOnlyFallback="Walk-in customer"
            label="Customer"
            placeholder="Search by name or phone…"
            noMatchLabel="No customers found"
            clearLabel="Remove customer"
            action={setDraft && !readOnly ? (
                <button
                    type="button"
                    onClick={() => {
                        setCustomer(null);
                        setDraft(emptyCustomerDraft);
                    }}
                    className="flex items-center justify-center px-2 py-1.5 border rounded text-gray-600 hover:bg-gray-50 hover:text-gray-900 min-h-touch sm:min-h-0"
                    title={t.shared.newCustomer}
                    aria-label={t.shared.newCustomer}
                >
                    <UserPlus className="w-4 h-4" />
                </button>
            ) : undefined}
            summary={(cust) => (
                <PartySummaryLine
                    parts={[
                        <span key="name" className="font-medium text-gray-700">{cust.name}</span>,
                        cust.phone,
                        cust.address,
                        Number(cust.due_balance ?? 0) > 0
                            ? `Due ৳${Number(cust.due_balance).toLocaleString()}`
                            : null,
                        cust.credit_limit ? `Limit ৳${Number(cust.credit_limit).toLocaleString()}` : null,
                        cust.loyalty_points ? `${cust.loyalty_points} pts` : null,
                    ]}
                />
            )}
        />
    );
}

'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2, UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import PartySearchSelect, {
    PartySummaryCard,
    type PartyOption,
} from '@/components/document-entry/PartySearchSelect';
import { formatBDT } from '@/lib/format';

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
const ICON_BUTTON_CLASS = 'flex items-center justify-center rounded px-2 py-1 min-h-touch sm:min-h-0';

/**
 * The sale's customer picker: the shared party typeahead plus credit context,
 * and — where the parent passes draft state — an inline "new customer" form.
 *
 * The draft is posted with the document (`newCustomer`), so nothing is created
 * until the sale, order or quote itself is. The tick beside the form is the way
 * out of that: it saves the customer on its own and selects them, so they are
 * on file — and pickable elsewhere — before the document is saved.
 */
export default function CustomerSelection({
    customer,
    setCustomer,
    readOnly = false,
    draft = null,
    setDraft,
    draftNameInvalid = false,
}: CustomerSelectionProps) {
    const { t, fmt, locale } = useI18n();
    const [customers, setCustomers] = useState<PartyOption[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    // The parent only knows the name is missing once it rejects a submit; the
    // tick has to say so itself.
    const [saveNameInvalid, setSaveNameInvalid] = useState(false);
    // Tied to the field rather than to the rejection, so typing a name clears
    // the complaint instead of leaving it up until the next submit.
    const nameInvalid = (draftNameInvalid || saveNameInvalid) && !draft?.name.trim();

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

    const updateDraft = (patch: Partial<NewCustomerDraft>) => {
        if (patch.name !== undefined) setSaveNameInvalid(false);
        setDraft?.({ ...(draft ?? emptyCustomerDraft), ...patch });
    };

    const closeDraft = () => {
        setSaveNameInvalid(false);
        setDraft?.(null);
    };

    /** Pick the customer and drop the draft, so the document posts an id. */
    const selectSaved = (saved: PartyOption) => {
        setCustomers((prev) => [saved, ...prev.filter((party) => party.id !== saved.id)]);
        setCustomer(saved);
        closeDraft();
    };

    /**
     * Save the drafted customer now rather than with the document. A phone
     * already on file belongs to one customer — the tenant index says so — so
     * that customer is selected instead of failing on the duplicate, which is
     * what saving with the document would have done anyway.
     */
    const saveDraftCustomer = async () => {
        if (!draft || !setDraft || saving) return;

        const payload = newCustomerPayload(draft);
        if (!payload?.name) {
            setSaveNameInvalid(true);
            return;
        }

        if (payload.phone) {
            const onFile = customers.find((party) => party.phone?.trim() === payload.phone);
            if (onFile) {
                selectSaved(onFile);
                toast.info(fmt(t.shared.customerPhoneOnFile, { name: onFile.name }));
                return;
            }
        }

        setSaving(true);
        try {
            const saved: PartyOption = await api.createCustomer(payload);
            selectSaved(saved);
            toast.success(fmt(t.shared.customerSaved, { name: saved.name }));
        } catch (error: any) {
            console.error('Failed to save the new customer', error);
            toast.error(error?.message || t.shared.customerSaveFailed);
        } finally {
            setSaving(false);
        }
    };

    // The form sits inside the document's <form>, where Enter would otherwise
    // submit the whole sale while the customer is still being typed.
    const handleDraftKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        void saveDraftCustomer();
    };

    if (draft && setDraft) {
        return (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {t.shared.newCustomer}
                    </span>
                    <div className="flex items-center gap-1">
                        <button
                            type="button"
                            onClick={saveDraftCustomer}
                            disabled={saving}
                            className={`${ICON_BUTTON_CLASS} bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400`}
                            title={t.shared.saveCustomerNow}
                            aria-label={t.shared.saveCustomerNow}
                        >
                            {saving
                                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                : <Check className="w-3.5 h-3.5" />}
                        </button>
                        <button
                            type="button"
                            onClick={closeDraft}
                            disabled={saving}
                            className={`${ICON_BUTTON_CLASS} border bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 disabled:text-gray-400`}
                            title={t.shared.useExisting}
                            aria-label={t.shared.useExisting}
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>
                <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    onKeyDown={handleDraftKeyDown}
                    placeholder={t.shared.customerNamePlaceholder}
                    aria-label={t.shared.customerNamePlaceholder}
                    aria-invalid={nameInvalid}
                    className={`${FIELD_CLASS} ${nameInvalid ? 'border-red-500' : ''}`}
                />
                {nameInvalid && (
                    <p className="text-xs text-red-600">{t.shared.customerNameRequiredInline}</p>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                    <input
                        type="text"
                        value={draft.phone}
                        onChange={(e) => updateDraft({ phone: e.target.value })}
                        onKeyDown={handleDraftKeyDown}
                        placeholder={t.common.phone}
                        aria-label={t.common.phone}
                        className={FIELD_CLASS}
                    />
                    <input
                        type="email"
                        value={draft.email}
                        onChange={(e) => updateDraft({ email: e.target.value })}
                        onKeyDown={handleDraftKeyDown}
                        placeholder={t.common.email}
                        aria-label={t.common.email}
                        className={FIELD_CLASS}
                    />
                </div>
                <input
                    type="text"
                    value={draft.address}
                    onChange={(e) => updateDraft({ address: e.target.value })}
                    onKeyDown={handleDraftKeyDown}
                    placeholder={t.common.address}
                    aria-label={t.common.address}
                    className={FIELD_CLASS}
                />
                <p className="text-[11px] text-gray-500">{t.shared.newCustomerHint}</p>
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
                        setSaveNameInvalid(false);
                        setDraft(emptyCustomerDraft);
                    }}
                    className="flex items-center justify-center px-2 py-1.5 border rounded text-gray-600 hover:bg-gray-50 hover:text-gray-900 min-h-touch sm:min-h-0"
                    title={t.shared.newCustomer}
                    aria-label={t.shared.newCustomer}
                >
                    <UserPlus className="w-4 h-4" />
                </button>
            ) : undefined}
            summary={(cust) => {
                const due = Number(cust.due_balance ?? 0);
                const creditLimit = Number(cust.credit_limit ?? 0);
                return (
                    <PartySummaryCard
                        name={cust.name}
                        details={[
                            cust.phone ? { label: t.common.phone, value: cust.phone } : null,
                            {
                                label: t.shared.due,
                                value: formatBDT(due, { locale }),
                                // Past the agreed limit is a decision to make before
                                // the sale, not a number to notice afterwards.
                                tone: due <= 0
                                    ? 'default'
                                    : creditLimit > 0 && due >= creditLimit ? 'danger' : 'warning',
                            },
                            creditLimit > 0
                                ? { label: t.customers.profile.creditLimit, value: formatBDT(creditLimit, { locale }) }
                                : null,
                            cust.loyalty_points
                                ? { label: t.shared.columns.points, value: String(cust.loyalty_points) }
                                : null,
                            cust.address ? { label: t.common.address, value: cust.address } : null,
                        ]}
                    />
                );
            }}
        />
    );
}

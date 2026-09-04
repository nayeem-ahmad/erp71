'use client';

import { useEffect, useState } from 'react';
import { UserPlus, X } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n } from '@/lib/i18n';
import PartySearchSelect, {
    PartySummaryLine,
    type PartyOption,
} from '@/components/document-entry/PartySearchSelect';

/** A supplier typed into the form but not saved yet — created with the purchase. */
export interface NewSupplierDraft {
    name: string;
    phone: string;
    email: string;
    address: string;
}

export const emptySupplierDraft: NewSupplierDraft = {
    name: '',
    phone: '',
    email: '',
    address: '',
};

interface SupplierSelectionProps {
    supplier: PartyOption | null;
    setSupplier: (supplier: PartyOption | null) => void;
    /** Non-null while the form is capturing a supplier that does not exist yet. */
    draft: NewSupplierDraft | null;
    setDraft: (draft: NewSupplierDraft | null) => void;
    /** Highlight the name box when a submit was rejected for missing it. */
    draftNameInvalid?: boolean;
}

const FIELD_CLASS = 'w-full border rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:border-transparent min-h-touch sm:min-h-0';

/**
 * Supplier picker for purchase entry — the same typeahead the sale screen uses
 * for customers, plus an inline "new supplier" form. The draft is posted with
 * the purchase (`newSupplier`), so nothing is created until the purchase is.
 */
export default function SupplierSelection({
    supplier,
    setSupplier,
    draft,
    setDraft,
    draftNameInvalid = false,
}: SupplierSelectionProps) {
    const { t, locale } = useI18n();
    const [suppliers, setSuppliers] = useState<PartyOption[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        api.getSuppliers()
            .then((data: PartyOption[]) => { if (!cancelled) setSuppliers(data ?? []); })
            .catch((error: unknown) => console.error('Failed to load suppliers', error))
            .finally(() => { if (!cancelled) setLoading(false); });

        return () => { cancelled = true; };
    }, []);

    const updateDraft = (patch: Partial<NewSupplierDraft>) =>
        setDraft({ ...(draft ?? emptySupplierDraft), ...patch });

    if (draft) {
        return (
            <div className="rounded border border-blue-200 bg-blue-50 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                        {t.purchaseShared.newSupplier}
                    </span>
                    <button
                        type="button"
                        onClick={() => setDraft(null)}
                        className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1"
                    >
                        <X className="w-3.5 h-3.5" />
                        {t.purchaseShared.useExisting}
                    </button>
                </div>
                <input
                    type="text"
                    value={draft.name}
                    onChange={(e) => updateDraft({ name: e.target.value })}
                    placeholder={t.purchaseShared.supplierNamePlaceholder}
                    aria-label={t.purchaseShared.supplierNamePlaceholder}
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
            parties={suppliers}
            loading={loading}
            selected={supplier}
            onSelect={setSupplier}
            label={t.common.supplier}
            placeholder={t.purchaseShared.searchSuppliers}
            noMatchLabel={t.purchaseShared.noSuppliersFound}
            clearLabel={t.purchaseShared.clearSupplier}
            action={(
                <button
                    type="button"
                    onClick={() => {
                        setSupplier(null);
                        setDraft(emptySupplierDraft);
                    }}
                    className="flex items-center justify-center px-2 py-1.5 border rounded text-gray-600 hover:bg-gray-50 hover:text-gray-900 min-h-touch sm:min-h-0"
                    title={t.purchaseShared.newSupplier}
                    aria-label={t.purchaseShared.newSupplier}
                >
                    <UserPlus className="w-4 h-4" />
                </button>
            )}
            summary={(picked) => (
                <PartySummaryLine
                    parts={[
                        <span key="name" className="font-medium text-gray-700">{picked.name}</span>,
                        picked.phone,
                        picked.address,
                        Number(picked.due_balance ?? 0) > 0
                            ? `${t.purchaseShared.payable} ${formatBDT(Number(picked.due_balance), { locale })}`
                            : null,
                    ]}
                />
            )}
        />
    );
}

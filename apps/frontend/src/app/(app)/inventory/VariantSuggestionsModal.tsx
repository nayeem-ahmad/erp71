'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';
import { api, type ProductFamilySuggestion } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

type VariantSuggestionsModalProps = {
    onClose: () => void;
    /** Opens the grouping dialog on one suggestion; nothing is grouped until it is saved there. */
    onReview: (suggestion: ProductFamilySuggestion) => void;
};

/**
 * Products whose names differ only by a trailing size or colour — "Belt OAC
 * S", "Belt OAC M" — listed for staff to review and group one at a time.
 */
export default function VariantSuggestionsModal({ onClose, onReview }: VariantSuggestionsModalProps) {
    const { t, fmt } = useI18n();
    const m = t.productVariants.admin;
    const [suggestions, setSuggestions] = useState<ProductFamilySuggestion[] | null>(null);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        api.getProductFamilySuggestions()
            .then((rows) => {
                if (!cancelled) setSuggestions(rows);
            })
            .catch((err: unknown) => {
                if (!cancelled) setError(err instanceof Error ? err.message : m.failed);
            });
        return () => {
            cancelled = true;
        };
    }, [m.failed]);

    return (
        <ModalShell size="md" onBackdropClick={onClose}>
            <ModalHeader title={m.suggestionsTitle} subtitle={m.suggestionsHelper} onClose={onClose} closeLabel={t.common.close} />
            <div className="space-y-2 overflow-y-auto p-4">
                {error && <Alert tone="danger">{error}</Alert>}
                {!error && suggestions === null && <p className="text-sm text-gray-500">{m.loading}</p>}
                {suggestions?.length === 0 && <p className="text-sm text-gray-500">{m.suggestionsEmpty}</p>}
                {suggestions?.map((suggestion) => (
                    <div
                        key={`${suggestion.optionName}:${suggestion.name}`}
                        className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-gray-900">{suggestion.name}</p>
                            <p className="truncate text-xs text-gray-500">
                                {suggestion.optionName}: {suggestion.members.map((member) => member.value).join(' · ')}
                                {' — '}
                                {fmt(m.productsCount, { count: suggestion.members.length })}
                            </p>
                        </div>
                        <Button variant="secondary" onClick={() => onReview(suggestion)} className="min-h-touch">
                            {m.review}
                        </Button>
                    </div>
                ))}
            </div>
            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} className="min-h-touch">
                    {t.common.close}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

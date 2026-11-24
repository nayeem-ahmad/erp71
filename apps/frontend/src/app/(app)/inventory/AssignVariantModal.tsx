'use client';

import { useEffect, useState } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { Alert, Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import { checkVariantChoice, emptyVariantChoice, newGroupDefaults, type VariantChoice } from '@/lib/variant-choice';
import VariantAssignmentFields from './VariantAssignmentFields';
import { useProductFamilies } from './useProductFamilies';

type AssignVariantModalProps = {
    product: { id: string; name: string };
    onClose: () => void;
    onSaved: () => void;
};

/**
 * "Set variant group" on a products-list row: put a product that is shown on
 * its own into an existing group, or start a new group with it. Saved through
 * the product's own update, so it is the same rule the product form applies.
 */
export default function AssignVariantModal({ product, onClose, onSaved }: AssignVariantModalProps) {
    const { t, fmt } = useI18n();
    const m = t.productVariants.admin;
    const { families, loading } = useProductFamilies(true);
    const [choice, setChoice] = useState<VariantChoice>(() => ({ ...emptyVariantChoice(), mode: 'existing' }));
    const [submitted, setSubmitted] = useState(false);
    const [saving, setSaving] = useState(false);
    const [serverError, setServerError] = useState('');

    // With no groups to join yet, starting one is the only useful choice.
    useEffect(() => {
        if (!loading && families.length === 0 && choice.mode === 'existing') {
            setChoice((prev) => ({ ...prev, mode: 'new', ...newGroupDefaults(product.name) }));
        }
    }, [loading, families.length, choice.mode, product.name]);

    const check = checkVariantChoice(choice, families, product.id);

    const save = async () => {
        setSubmitted(true);
        setServerError('');
        if ('error' in check) return;
        if (!check.variant) {
            onClose();
            return;
        }
        setSaving(true);
        try {
            const saved = await api.updateProduct(product.id, { variant: check.variant });
            toast.success(fmt(m.assigned, { name: product.name, group: saved?.family?.name ?? '' }));
            onSaved();
            onClose();
        } catch (err: unknown) {
            setServerError(err instanceof Error ? err.message : m.failed);
        } finally {
            setSaving(false);
        }
    };

    const close = saving ? undefined : onClose;

    return (
        <ModalShell size="md" onBackdropClick={close} dismissOnBackdrop={false}>
            <ModalHeader title={fmt(m.assignTitle, { name: product.name })} subtitle={m.assignHelper} onClose={close} closeLabel={m.cancel} />
            <div className="space-y-3 overflow-y-auto p-4">
                {serverError && <Alert tone="danger">{serverError}</Alert>}
                {loading ? (
                    <p className="text-sm text-gray-500">{m.loading}</p>
                ) : (
                    <VariantAssignmentFields
                        productName={product.name}
                        productId={product.id}
                        families={families}
                        value={choice}
                        onChange={setChoice}
                        error={submitted && 'error' in check ? { field: check.field, message: check.error } : null}
                    />
                )}
            </div>
            <ModalFooter>
                <Button variant="secondary" size="md" onClick={onClose} disabled={saving} className="min-h-touch">
                    {m.cancel}
                </Button>
                <Button size="md" onClick={() => void save()} disabled={loading || saving} loading={saving} className="min-h-touch">
                    {m.save}
                </Button>
            </ModalFooter>
        </ModalShell>
    );
}

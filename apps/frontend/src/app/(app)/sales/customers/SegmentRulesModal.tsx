'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/lib/toast';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { Button, Field, Input } from '@/components/ui';

type Props = {
    open: boolean;
    onClose: () => void;
    onSaved: () => Promise<void> | void;
};

export default function SegmentRulesModal({ open, onClose, onSaved }: Props) {
    const { t, fmt } = useI18n();
    const copy = t.customers.segmentRulesModal;
    const [vipSpend, setVipSpend] = useState('50000');
    const [atRiskDays, setAtRiskDays] = useState('30');
    const [newAccountDays, setNewAccountDays] = useState('30');
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        api.getCustomerSegmentSettings()
            .then((data: { vip_spend_bdt?: number; at_risk_days?: number; new_account_days?: number }) => {
                if (cancelled) return;
                if (data?.vip_spend_bdt != null) setVipSpend(String(data.vip_spend_bdt));
                if (data?.at_risk_days != null) setAtRiskDays(String(data.at_risk_days));
                if (data?.new_account_days != null) setNewAccountDays(String(data.new_account_days));
            })
            .catch(() => {
                if (!cancelled) toast.error(copy.loadFailed);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [open, copy.loadFailed]);

    if (!open) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        const vip_spend_bdt = Number(vipSpend);
        const at_risk_days = Number(atRiskDays);
        const new_account_days = Number(newAccountDays);
        if (!Number.isFinite(vip_spend_bdt) || vip_spend_bdt < 0) return;
        if (!Number.isInteger(at_risk_days) || at_risk_days < 1) return;
        if (!Number.isInteger(new_account_days) || new_account_days < 1) return;

        setSaving(true);
        try {
            const result = await api.updateCustomerSegmentSettings({
                vip_spend_bdt,
                at_risk_days,
                new_account_days,
            });
            toast.success(fmt(copy.saved, { count: Number(result?.updated ?? 0) }));
            await onSaved();
            onClose();
        } catch (err: any) {
            toast.error(err?.message || copy.saveFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <ModalShell size="sm" onBackdropClick={onClose}>
            <form onSubmit={handleSave} className="flex flex-col overflow-hidden">
                <ModalHeader title={copy.title} subtitle={copy.subtitle} onClose={onClose} />
                <div className="p-4 space-y-4 overflow-y-auto">
                    <Field label={copy.vipSpend} hint={copy.vipSpendHint} htmlFor="segment-vip-spend">
                        <Input
                            id="segment-vip-spend"
                            type="number"
                            min={0}
                            step="1"
                            value={vipSpend}
                            onChange={(e) => setVipSpend(e.target.value)}
                            disabled={loading || saving}
                            required
                        />
                    </Field>
                    <Field label={copy.atRiskDays} hint={copy.atRiskDaysHint} htmlFor="segment-at-risk-days">
                        <Input
                            id="segment-at-risk-days"
                            type="number"
                            min={1}
                            step="1"
                            value={atRiskDays}
                            onChange={(e) => setAtRiskDays(e.target.value)}
                            disabled={loading || saving}
                            required
                        />
                    </Field>
                    <Field label={copy.newAccountDays} hint={copy.newAccountDaysHint} htmlFor="segment-new-account-days">
                        <Input
                            id="segment-new-account-days"
                            type="number"
                            min={1}
                            step="1"
                            value={newAccountDays}
                            onChange={(e) => setNewAccountDays(e.target.value)}
                            disabled={loading || saving}
                            required
                        />
                    </Field>
                </div>
                <ModalFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        {t.common.cancel}
                    </Button>
                    <Button type="submit" variant="primary" loading={saving} disabled={loading}>
                        {saving ? copy.saving : copy.save}
                    </Button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

'use client';

import { useEffect, useState, type FormEvent } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountCategory = 'cash' | 'bank' | 'general';

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
export const ACCOUNT_CATEGORIES: AccountCategory[] = ['cash', 'bank', 'general'];

export interface AccountGroup {
    id: string;
    name: string;
    type: AccountType;
    _count?: { subgroups?: number; accounts?: number };
}

export interface AccountSubgroup {
    id: string;
    name: string;
    group_id?: string;
    group?: { id: string; name: string } | null;
    _count?: { accounts?: number };
}

export interface Account {
    id: string;
    name: string;
    code?: string | null;
    type: AccountType;
    category: AccountCategory;
    group?: AccountGroup | null;
    subgroup?: AccountSubgroup | null;
}

/** Subgroups arrive either embedded (`group.id`) or flat (`group_id`). */
export function subgroupGroupId(subgroup: AccountSubgroup): string {
    return subgroup.group?.id ?? subgroup.group_id ?? '';
}

interface AccountFormModalProps {
    /** `null` opens the modal in create mode. */
    account: Account | null;
    groups: AccountGroup[];
    subgroups: AccountSubgroup[];
    onClose: () => void;
    onSaved: () => Promise<void> | void;
}

export default function AccountFormModal({
    account,
    groups,
    subgroups,
    onClose,
    onSaved,
}: Readonly<AccountFormModalProps>) {
    const { t } = useI18n();
    const [groupId, setGroupId] = useState(account?.group?.id ?? '');
    const [subgroupId, setSubgroupId] = useState(account?.subgroup?.id ?? '');
    const [name, setName] = useState(account?.name ?? '');
    const [code, setCode] = useState(account?.code ?? '');
    const [category, setCategory] = useState<AccountCategory>(account?.category ?? 'general');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const selectedGroup = groups.find((group) => group.id === groupId) ?? null;
    /**
     * Never chosen by hand: the API rejects an account whose type differs from its
     * group's, so the type is derived from the group and shown read-only.
     */
    const derivedType = selectedGroup?.type ?? account?.type ?? null;
    const availableSubgroups = subgroups.filter((subgroup) => subgroupGroupId(subgroup) === groupId);

    // Drop a subgroup that no longer belongs to the chosen group.
    useEffect(() => {
        setSubgroupId((current) => {
            if (!current) return current;
            const stillValid = subgroups.some(
                (subgroup) => subgroup.id === current && subgroupGroupId(subgroup) === groupId,
            );
            return stillValid ? current : '';
        });
    }, [groupId, subgroups]);

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault();
        if (!groupId || !derivedType || saving) return;

        setSaving(true);
        setError('');

        try {
            const payload = {
                groupId,
                subgroupId: subgroupId || undefined,
                name: name.trim(),
                code: code.trim() || undefined,
                category,
            };

            if (account) {
                await api.updateAccount(account.id, payload);
                toast.success(t.coa.accountUpdated);
            } else {
                await api.createAccount({ ...payload, type: derivedType });
                toast.success(t.coa.accountCreated);
            }

            await onSaved();
        } catch (submitError: any) {
            setError(
                submitError?.message ||
                    (account ? t.coa.saveAccountFailed : t.coa.createAccountFailed),
            );
        } finally {
            setSaving(false);
        }
    };

    let submitLabel: string;
    if (saving) {
        submitLabel = account ? t.coa.saving : t.coa.creating;
    } else {
        submitLabel = account ? t.coa.updateAccount : t.coa.createAccount;
    }

    return (
        <ModalShell size="md" onBackdropClick={saving ? undefined : onClose}>
            <ModalHeader
                title={account ? t.coa.editAccount : t.coa.newAccount}
                subtitle={account?.name}
                onClose={saving ? undefined : onClose}
                closeLabel={t.common.close}
            />

            <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {error ? (
                        <div className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                            {error}
                        </div>
                    ) : null}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>
                                {t.coa.accountGroup}
                            </span>
                            <select
                                aria-label={t.coa.accountGroup}
                                value={groupId}
                                onChange={(event) => setGroupId(event.target.value)}
                                required
                                className={compactDensity.formField}
                            >
                                <option value="">{t.coa.selectGroup}</option>
                                {groups.map((group) => (
                                    <option key={group.id} value={group.id}>
                                        {group.name}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>
                                {t.coa.accountSubgroup}
                            </span>
                            <select
                                aria-label={t.coa.accountSubgroup}
                                value={subgroupId}
                                onChange={(event) => setSubgroupId(event.target.value)}
                                disabled={!groupId || availableSubgroups.length === 0}
                                className={`${compactDensity.formField} disabled:opacity-60`}
                            >
                                <option value="">{t.coa.noSubgroup}</option>
                                {availableSubgroups.map((subgroup) => (
                                    <option key={subgroup.id} value={subgroup.id}>
                                        {subgroup.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>

                    <label className="block">
                        <span className={`${compactDensity.formLabel} block mb-1`}>
                            {t.coa.accountName}
                        </span>
                        <input
                            aria-label={t.coa.accountName}
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            required
                            className={compactDensity.formField}
                            placeholder={t.coa.cashInHand}
                        />
                    </label>

                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>
                                {t.coa.accountCode}
                            </span>
                            <input
                                aria-label={t.coa.accountCode}
                                value={code}
                                onChange={(event) => setCode(event.target.value)}
                                className={compactDensity.formField}
                                placeholder="1010"
                            />
                        </label>

                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>
                                {t.coa.accountType}
                            </span>
                            <input
                                aria-label={t.coa.accountType}
                                value={derivedType ? t.accountingShared.accountTypes[derivedType] : ''}
                                readOnly
                                disabled
                                className={`${compactDensity.formField} disabled:opacity-60`}
                            />
                            <span className="mt-1 block text-xs text-gray-400">
                                {t.coa.typeFollowsGroup}
                            </span>
                        </label>

                        <label className="block">
                            <span className={`${compactDensity.formLabel} block mb-1`}>
                                {t.accountingShared.category}
                            </span>
                            <select
                                aria-label={t.accountingShared.category}
                                value={category}
                                onChange={(event) => setCategory(event.target.value as AccountCategory)}
                                className={compactDensity.formField}
                            >
                                {ACCOUNT_CATEGORIES.map((option) => (
                                    <option key={option} value={option}>
                                        {t.accountingShared.accountCategories[option]}
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>

                <ModalFooter>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={saving}
                        className={`${compactDensity.btnSecondary} min-h-touch disabled:opacity-60`}
                    >
                        {t.common.cancel}
                    </button>
                    <button
                        type="submit"
                        disabled={saving || !groupId || !name.trim()}
                        className={`${compactDensity.btnPrimary} min-h-touch bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60`}
                    >
                        {submitLabel}
                    </button>
                </ModalFooter>
            </form>
        </ModalShell>
    );
}

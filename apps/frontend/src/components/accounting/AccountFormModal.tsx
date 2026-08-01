'use client';

import { useEffect, useState, type FormEvent } from 'react';
import ModalShell, { ModalFooter, ModalHeader } from '@/components/ModalShell';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type AccountCategory = 'cash' | 'bank' | 'general';

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
export const ACCOUNT_CATEGORIES: AccountCategory[] = ['cash', 'bank', 'general'];

export interface AccountGroup {
    id: string;
    name: string;
    /** `<type digit><serial>`, e.g. 11 for the first asset group. */
    code: string;
    type: AccountType;
    _count?: { subgroups?: number; accounts?: number };
}

export interface AccountSubgroup {
    id: string;
    name: string;
    /** Always starts with its group's code, e.g. 1101 under group 11. */
    code: string;
    group_id?: string;
    group?: { id: string; name: string; code?: string } | null;
    _count?: { accounts?: number };
}

export interface Account {
    id: string;
    name: string;
    /**
     * Always starts with its subgroup's code (or `<group>00` when it has none).
     * Nullable only until the phase-B tightening — the boot-time backfill fills
     * every row before the API serves, so in practice this is always set.
     */
    code?: string | null;
    /** The flat 4-digit code this account had before hierarchical codes. */
    legacy_code?: string | null;
    type: AccountType;
    category: AccountCategory;
    group?: AccountGroup | null;
    subgroup?: AccountSubgroup | null;
    /** All-time closing balance, presented as a positive amount plus the side it sits on. */
    balance?: number;
    balance_side?: 'debit' | 'credit' | 'neutral';
}

/** Subgroups arrive either embedded (`group.id`) or flat (`group_id`). */
export function subgroupGroupId(subgroup: AccountSubgroup): string {
    return subgroup.group?.id ?? subgroup.group_id ?? '';
}

/** Reserved slot for accounts that hang directly off a group. */
const NO_SUBGROUP_SLOT = '00';

/** The prefix every account under this parent must carry. */
export function accountCodePrefix(
    group: AccountGroup | null,
    subgroup: AccountSubgroup | null,
): string {
    if (!group) return '';
    return subgroup?.code ?? group.code + NO_SUBGROUP_SLOT;
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
    const [codeSuggestion, setCodeSuggestion] = useState('');
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
    const selectedSubgroup = availableSubgroups.find((sub) => sub.id === subgroupId) ?? null;
    const codePrefix = accountCodePrefix(selectedGroup, selectedSubgroup);

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

    /**
     * Suggest the next free code whenever the parent changes, so the field is
     * pre-filled rather than asking the user to invent a code that has to match
     * a prefix. Only ever a suggestion — the field stays editable, and the server
     * re-validates whatever is submitted.
     */
    useEffect(() => {
        if (!groupId) return;

        let cancelled = false;
        setCodeSuggestion('');

        api.getNextAccountCode(groupId, subgroupId || undefined)
            .then((result: { code: string }) => {
                if (cancelled) return;
                setCodeSuggestion(result.code);
                // Don't clobber a code the user typed, nor an existing account's
                // code that already sits under the selected parent.
                setCode((current) => (current && !isStale(current) ? current : result.code));
            })
            .catch(() => {
                // A suggestion is a convenience; the user can still type a code.
            });

        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groupId, subgroupId]);

    /** True when `value` no longer belongs under the currently selected parent. */
    function isStale(value: string) {
        return Boolean(codePrefix) && !value.startsWith(codePrefix);
    }

    // Compared against the ORIGINAL code, not the field: moving the account
    // re-fills the field with a suggestion, so the field alone would never look
    // changed and the warning would never fire.
    const willBeRecoded = Boolean(account) && Boolean(code) && code !== (account?.code ?? '');

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

                    {willBeRecoded ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                            {formatMessage(t.coa.codeWillChange, {
                                from: account?.code ?? '',
                                to: code,
                            })}
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
                                onChange={(event) => setCode(event.target.value.toUpperCase())}
                                maxLength={6}
                                className={`${compactDensity.formField} font-mono`}
                                placeholder={codeSuggestion || '110101'}
                            />
                            {codePrefix ? (
                                <span className="mt-1 block text-xs text-gray-400">
                                    {formatMessage(t.coa.codeMustStartWith, { prefix: codePrefix })}
                                </span>
                            ) : null}
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

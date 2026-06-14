'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BookOpen, FolderTree, Landmark, Plus } from 'lucide-react';
import Link from 'next/link';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import { COA_FIELD_HELP, COA_HELP } from '@/lib/help/contextual-help';
import { api } from '../../../../lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';

type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
type AccountCategory = 'cash' | 'bank' | 'general';

interface AccountGroup {
    id: string;
    name: string;
    type: AccountType;
    _count?: { subgroups?: number; accounts?: number };
}

interface AccountSubgroup {
    id: string;
    name: string;
    group_id?: string;
    group?: AccountGroup;
    _count?: { accounts?: number };
}

interface Account {
    id: string;
    name: string;
    code?: string | null;
    type: AccountType;
    category: AccountCategory;
    group?: AccountGroup;
    subgroup?: AccountSubgroup | null;
}

const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];
const ACCOUNT_CATEGORIES: AccountCategory[] = ['cash', 'bank', 'general'];
const columnHelper = createColumnHelper<Account>();

export default function ChartOfAccountsPage() {
    const { t, locale } = useI18n();
    const [groups, setGroups] = useState<AccountGroup[]>([]);
    const [subgroups, setSubgroups] = useState<AccountSubgroup[]>([]);
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [loading, setLoading] = useState(true);
    const [groupFilter, setGroupFilter] = useState('');
    const [typeFilter, setTypeFilter] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('');

    useEffect(() => {
        void loadReferenceData();
    }, []);

    useEffect(() => {
        void loadAccounts();
    }, [groupFilter, typeFilter, categoryFilter]);

    const loadReferenceData = async () => {
        try {
            const [groupData, subgroupData] = await Promise.all([
                api.getAccountGroups(),
                api.getAccountSubgroups(),
            ]);
            setGroups(groupData);
            setSubgroups(subgroupData);
        } catch (error) {
            console.error('Failed to load chart-of-accounts reference data', error);
        }
    };

    const loadAccounts = async () => {
        try {
            const accountData = await api.getAccounts({
                groupId: groupFilter || undefined,
                type: typeFilter || undefined,
                category: categoryFilter || undefined,
            });
            setAccounts(accountData);
        } catch (error) {
            console.error('Failed to load accounts', error);
        } finally {
            setLoading(false);
        }
    };

    const refreshAll = async () => {
        setLoading(true);
        await Promise.all([loadReferenceData(), loadAccounts()]);
        setLoading(false);
    };

    const columns: ColumnDef<Account, any>[] = useMemo(
        () => [
            columnHelper.accessor('name', {
                header: t.accountingShared.account,
                cell: (info) => (
                    <div>
                        <span className="block text-sm font-black text-gray-900">{info.row.original.name}</span>
                        <span className="block text-xs text-gray-400">{info.row.original.code || t.accountingShared.noCode}</span>
                    </div>
                ),
                size: 240,
            }),
            columnHelper.accessor('type', {
                header: t.accountingShared.type,
                cell: (info) => <Badge>{info.getValue()}</Badge>,
                size: 120,
            }),
            columnHelper.accessor('category', {
                header: t.accountingShared.category,
                cell: (info) => <Badge tone="secondary">{info.getValue()}</Badge>,
                size: 120,
            }),
            columnHelper.accessor((row) => row.group?.name || '-', {
                id: 'group',
                header: t.accountingShared.group,
                cell: (info) => <span className="text-sm font-bold text-gray-700">{info.getValue()}</span>,
                size: 180,
            }),
            columnHelper.accessor((row) => row.subgroup?.name || t.coa.unassigned, {
                id: 'subgroup',
                header: t.accountingShared.subgroup,
                cell: (info) => <span className="text-sm text-gray-500">{info.getValue()}</span>,
                size: 180,
            }),
        ],
        [t],
    );

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="w-full space-y-6">
                <Link href="/dashboard/accounting" className="inline-flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                    <ArrowLeft className="w-4 h-4 mr-2" />
                    {t.accountingShared.backToAccounting}
                </Link>

                <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div>
                        <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">{t.coa.story}</p>
                        <h1 className="text-3xl font-black tracking-tight inline-flex items-center gap-2">
                            {t.coa.title}
                            <HelpTooltip text={COA_FIELD_HELP.page} wide />
                        </h1>
                        <p className="text-sm text-gray-500 mt-2 max-w-3xl">
                            {t.coa.pageSubtitle}
                        </p>
                    </div>
                    <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3">
                        <p className="text-[11px] font-black uppercase tracking-[0.24em] text-amber-700">{t.coa.bootstrapActive}</p>
                        <p className="text-sm font-bold text-amber-900">{t.coa.bootstrapHint}</p>
                    </div>
                </div>

                <ContextualHelpPanel {...COA_HELP} />

                <div className="grid gap-4 xl:grid-cols-3">
                    <InlineFormCard icon={<FolderTree className="w-5 h-5" />} title={t.coa.newGroup} subtitle={t.coa.createGroupHint} helpText={COA_FIELD_HELP.group}>
                        <AccountGroupForm onSuccess={refreshAll} />
                    </InlineFormCard>

                    <InlineFormCard icon={<BookOpen className="w-5 h-5" />} title={t.coa.newSubgroup} subtitle={t.coa.createSubgroupHint} helpText={COA_FIELD_HELP.subgroup}>
                        <AccountSubgroupForm groups={groups} onSuccess={refreshAll} />
                    </InlineFormCard>

                    <InlineFormCard icon={<Landmark className="w-5 h-5" />} title={t.coa.newAccount} subtitle={t.coa.createAccountHint} helpText={COA_FIELD_HELP.account}>
                        <AccountForm groups={groups} subgroups={subgroups} onSuccess={refreshAll} />
                    </InlineFormCard>
                </div>

                <div className="grid gap-4 lg:grid-cols-[1.2fr,1fr]">
                    <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                        <div className="flex items-center justify-between gap-4 flex-wrap">
                            <div>
                                <h2 className="text-xl font-black tracking-tight">{t.coa.accountDirectory}</h2>
                                <p className="text-xs font-bold uppercase tracking-widest text-gray-400 mt-1">{t.coa.directorySubtitle}</p>
                            </div>
                            <div className="flex gap-3 flex-wrap">
                                <FilterSelect label={t.coa.filterByGroup} value={groupFilter} onChange={setGroupFilter} options={groups.map((group) => ({ value: group.id, label: group.name }))} />
                                <FilterSelect label={t.coa.filterByType} value={typeFilter} onChange={setTypeFilter} options={ACCOUNT_TYPES.map((type) => ({ value: type, label: type }))} helpText={COA_FIELD_HELP.accountType} />
                                <FilterSelect label={t.coa.filterByCategory} value={categoryFilter} onChange={setCategoryFilter} options={ACCOUNT_CATEGORIES.map((category) => ({ value: category, label: category }))} helpText={COA_FIELD_HELP.accountCategory} />
                            </div>
                        </div>

                        <DataTable<Account>
                            tableId="accounting-coa-accounts"
                            columns={columns}
                            data={accounts}
                            title={t.coa.title}
                            isLoading={loading}
                            emptyMessage={t.coa.emptyMessage}
                            emptyIcon={<BookOpen className="w-16 h-16 text-gray-200" />}
                            searchPlaceholder={t.coa.searchPlaceholder}
                        />
                    </section>

                    <section className="space-y-4">
                        <HierarchySummaryCard
                            title={t.coa.groups}
                            subtitle={t.coa.groupsSubtitle}
                            items={groups.map((group) => ({
                                id: group.id,
                                title: group.name,
                                meta: `${group.type} • ${group._count?.subgroups ?? 0} subgroups • ${group._count?.accounts ?? 0} accounts`,
                            }))}
                            icon={<FolderTree className="w-5 h-5" />}
                        />
                        <HierarchySummaryCard
                            title={t.coa.subgroups}
                            subtitle={t.coa.subgroupsSubtitle}
                            items={subgroups.map((subgroup) => ({
                                id: subgroup.id,
                                title: subgroup.name,
                                meta: `${subgroup.group?.name || t.coa.unknownGroup} • ${subgroup._count?.accounts ?? 0} accounts`,
                            }))}
                            icon={<BookOpen className="w-5 h-5" />}
                        />
                    </section>
                </div>
            </div>
        </div>
    );
}

function InlineFormCard({ icon, title, subtitle, helpText, children }: { icon: React.ReactNode; title: string; subtitle: string; helpText?: string; children: React.ReactNode }) {
    return (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-5">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-gray-700">{icon}</div>
                <div>
                    <h2 className="text-lg font-black tracking-tight inline-flex items-center gap-2">
                        {title}
                        {helpText ? <HelpTooltip text={helpText} side="right" /> : null}
                    </h2>
                    <p className="text-sm text-gray-500">{subtitle}</p>
                </div>
            </div>
            {children}
        </section>
    );
}

function FilterSelect({ label, value, onChange, options, helpText }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; helpText?: string }) {
    return (
        <div className="text-xs font-bold uppercase tracking-widest text-gray-400 space-y-1">
            <span className="inline-flex items-center gap-1.5">
                {label}
                {helpText ? <HelpTooltip text={helpText} side="top" /> : null}
            </span>
            <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="block min-w-[180px] rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700">
                <option value="">All</option>
                {options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                ))}
            </select>
        </div>
    );
}

function HierarchySummaryCard({ title, subtitle, items, icon }: { title: string; subtitle: string; items: { id: string; title: string; meta: string }[]; icon: React.ReactNode }) {
    return (
        <section className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start gap-3 mb-4">
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-3 text-gray-700">{icon}</div>
                <div>
                    <h2 className="text-lg font-black tracking-tight">{title}</h2>
                    <p className="text-sm text-gray-500">{subtitle}</p>
                </div>
            </div>
            <div className="space-y-3 max-h-[320px] overflow-auto pr-1">
                {items.length === 0 ? (
                    <p className="text-sm text-gray-400">Nothing created yet.</p>
                ) : (
                    items.map((item) => (
                        <div key={item.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                            <p className="text-sm font-black text-gray-900">{item.title}</p>
                            <p className="text-xs text-gray-500 mt-1">{item.meta}</p>
                        </div>
                    ))
                )}
            </div>
        </section>
    );
}

function Badge({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'secondary' }) {
    const classes = tone === 'secondary'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';

    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-widest ${classes}`}>{children}</span>;
}

function AccountGroupForm({ onSuccess }: { onSuccess: () => Promise<void> }) {
    const { t } = useI18n();
    const [name, setName] = useState('');
    const [type, setType] = useState<AccountType>('asset');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.createAccountGroup({ name, type });
            setName('');
            setType('asset');
            await onSuccess();
        } catch (submitError: any) {
            setError(submitError.message || t.coa.createGroupFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="space-y-4" onSubmit={handleSubmit}>
            {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</div> : null}
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.groupName}</span>
                <input aria-label={t.coa.groupName} value={name} onChange={(event) => setName(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800" placeholder={t.coa.currentAssets} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.groupType}</span>
                <select aria-label={t.coa.groupType} value={type} onChange={(event) => setType(event.target.value as AccountType)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                    {ACCOUNT_TYPES.map((option) => <option key={option} value={option}>{t.accountingShared.accountTypes[option]}</option>)}
                </select>
            </label>
            <button type="submit" disabled={saving} className="inline-flex items-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-blue-200 disabled:opacity-60">
                <Plus className="w-4 h-4 mr-2" />
                {saving ? t.coa.creating : t.coa.createGroup}
            </button>
        </form>
    );
}

function AccountSubgroupForm({ groups, onSuccess }: { groups: AccountGroup[]; onSuccess: () => Promise<void> }) {
    const { t } = useI18n();
    const [groupId, setGroupId] = useState('');
    const [name, setName] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.createAccountSubgroup({ groupId, name });
            setName('');
            setGroupId('');
            await onSuccess();
        } catch (submitError: any) {
            setError(submitError.message || t.coa.createSubgroupFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="space-y-4" onSubmit={handleSubmit}>
            {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</div> : null}
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.parentGroup}</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                    <option value="">{t.coa.selectGroup}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.subgroupName}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800" placeholder={t.coa.cashAndBank} />
            </label>
            <button type="submit" disabled={saving} className="inline-flex items-center rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-emerald-200 disabled:opacity-60">
                <Plus className="w-4 h-4 mr-2" />
                {saving ? t.coa.creating : t.coa.createSubgroup}
            </button>
        </form>
    );
}

function AccountForm({ groups, subgroups, onSuccess }: { groups: AccountGroup[]; subgroups: AccountSubgroup[]; onSuccess: () => Promise<void> }) {
    const { t } = useI18n();
    const [groupId, setGroupId] = useState('');
    const [subgroupId, setSubgroupId] = useState('');
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [type, setType] = useState<AccountType>('asset');
    const [category, setCategory] = useState<AccountCategory>('general');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const selectedGroup = groups.find((group) => group.id === groupId);
        if (selectedGroup) {
            setType(selectedGroup.type);
        }
        setSubgroupId('');
    }, [groupId, groups]);

    const filteredSubgroups = subgroups.filter((subgroup) => !groupId || subgroup.group?.id === groupId || subgroup.group_id === groupId);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await api.createAccount({
                groupId,
                subgroupId: subgroupId || undefined,
                name,
                code: code || undefined,
                type,
                category,
            });
            setName('');
            setCode('');
            setGroupId('');
            setSubgroupId('');
            setType('asset');
            setCategory('general');
            await onSuccess();
        } catch (submitError: any) {
            setError(submitError.message || t.coa.createAccountFailed);
        } finally {
            setSaving(false);
        }
    };

    return (
        <form className="space-y-4" onSubmit={handleSubmit}>
            {error ? <div className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-600">{error}</div> : null}
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.accountGroup}</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                    <option value="">{t.coa.selectGroup}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.accountSubgroup}</span>
                <select value={subgroupId} onChange={(event) => setSubgroupId(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                    <option value="">{t.accountingShared.optional}</option>
                    {filteredSubgroups.map((subgroup) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                </select>
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.accountName}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800" placeholder={t.coa.cashInHand} />
            </label>
            <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                <span>{t.coa.accountCode}</span>
                <input value={code} onChange={(event) => setCode(event.target.value)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800" placeholder="1010" />
            </label>
            <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                    <span>{t.coa.accountType}</span>
                    <select value={type} onChange={(event) => setType(event.target.value as AccountType)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                        {ACCOUNT_TYPES.map((option) => <option key={option} value={option}>{t.accountingShared.accountTypes[option]}</option>)}
                    </select>
                </label>
                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400">
                    <span>{t.accountingShared.category}</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value as AccountCategory)} className="mt-1 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-bold text-gray-800">
                        {ACCOUNT_CATEGORIES.map((option) => <option key={option} value={option}>{t.accountingShared.accountCategories[option]}</option>)}
                    </select>
                </label>
            </div>
            <button type="submit" disabled={saving} className="inline-flex items-center rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-black text-white shadow-lg shadow-violet-200 disabled:opacity-60">
                <Plus className="w-4 h-4 mr-2" />
                {saving ? t.coa.creating : t.coa.createAccount}
            </button>
        </form>
    );
}
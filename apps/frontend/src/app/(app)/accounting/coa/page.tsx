'use client';

import { useEffect, useMemo, useState } from 'react';
import { BookOpen, FolderTree, Landmark, Plus } from 'lucide-react';
import { createColumnHelper, type ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ContextualHelpPanel } from '@/components/ContextualHelpPanel';
import { HelpTooltip } from '@/components/HelpTooltip';
import {
    AccountingPageShell,
    AccountingToolbar,
    CompactSection,
} from '@/components/accounting/compact';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { COA_FIELD_HELP, COA_HELP } from '@/lib/help/contextual-help';
import { api } from '@/lib/api';
import { useI18n, formatMessage } from '@/lib/i18n';
import { compactDensity } from '@/lib/ui/compact-density';

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
                        <span className="block text-sm font-bold text-gray-900">{info.row.original.name}</span>
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
        <AccountingPageShell>
            <PageHeader
                title={t.coa.title}
                subtitle={t.coa.pageSubtitle}
                breadcrumbs={modulePageBreadcrumbs(
                    t.dashboardHome.breadcrumbHome,
                    t.sidebar.modules.accounting,
                    t.coa.title,
                    'accounting',
                )}
                actions={(
                    <div className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-1.5 text-right">
                        <p className="text-[10px] font-medium text-amber-600">{t.coa.bootstrapActive}</p>
                        <p className="text-xs font-semibold text-amber-900">{t.coa.bootstrapHint}</p>
                    </div>
                )}
            />
            <AccountingToolbar help={COA_FIELD_HELP.page} />

            <ContextualHelpPanel {...COA_HELP} />

            <div className="grid gap-3 xl:grid-cols-3">
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

                <div className="grid gap-3 lg:grid-cols-[1.2fr,1fr]">
                    <CompactSection title={t.coa.accountDirectory}>
                        <div className={`${compactDensity.filterBar} mb-3`}>
                            <FilterSelect label={t.coa.filterByGroup} value={groupFilter} onChange={setGroupFilter} options={groups.map((group) => ({ value: group.id, label: group.name }))} />
                            <FilterSelect label={t.coa.filterByType} value={typeFilter} onChange={setTypeFilter} options={ACCOUNT_TYPES.map((type) => ({ value: type, label: type }))} helpText={COA_FIELD_HELP.accountType} />
                            <FilterSelect label={t.coa.filterByCategory} value={categoryFilter} onChange={setCategoryFilter} options={ACCOUNT_CATEGORIES.map((category) => ({ value: category, label: category }))} helpText={COA_FIELD_HELP.accountCategory} />
                        </div>

                        <DataTable<Account>
                            tableId="accounting-coa-accounts"
                            columns={columns}
                            data={accounts}
                            title={t.coa.title}
                            isLoading={loading}
                            emptyMessage={t.coa.emptyMessage}
                            emptyIcon={<BookOpen className="w-10 h-10 text-gray-200" />}
                            searchPlaceholder={t.coa.searchPlaceholder}
                        />
                    </CompactSection>

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
        </AccountingPageShell>
    );
}

function InlineFormCard({ icon, title, subtitle, helpText, children }: { icon: React.ReactNode; title: string; subtitle: string; helpText?: string; children: React.ReactNode }) {
    return (
        <CompactSection>
            <div className="flex items-start gap-2 mb-3">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-700">{icon}</div>
                <div>
                    <p className={`${compactDensity.sectionLabel} inline-flex items-center gap-1.5`}>
                        {title}
                        {helpText ? <HelpTooltip text={helpText} side="right" /> : null}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
                </div>
            </div>
            {children}
        </CompactSection>
    );
}

function FilterSelect({ label, value, onChange, options, helpText }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[]; helpText?: string }) {
    return (
        <div className="space-y-1">
            <span className={`${compactDensity.formLabel} inline-flex items-center gap-1.5`}>
                {label}
                {helpText ? <HelpTooltip text={helpText} side="top" /> : null}
            </span>
            <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className={`${compactDensity.formField} min-w-[160px]`}>
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
        <CompactSection title={title}>
            <div className="flex items-start gap-2 mb-2">
                <div className="rounded-lg border border-gray-200 bg-gray-50 p-2 text-gray-700">{icon}</div>
                <p className="text-xs text-gray-500">{subtitle}</p>
            </div>
            <div className="space-y-2 max-h-[280px] overflow-auto pr-1">
                {items.length === 0 ? (
                    <p className="text-xs text-gray-400">Nothing created yet.</p>
                ) : (
                    items.map((item) => (
                        <div key={item.id} className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2">
                            <p className="text-sm font-semibold text-gray-900">{item.title}</p>
                            <p className="text-xs text-gray-500 mt-0.5">{item.meta}</p>
                        </div>
                    ))
                )}
            </div>
        </CompactSection>
    );
}

function Badge({ children, tone = 'primary' }: { children: React.ReactNode; tone?: 'primary' | 'secondary' }) {
    const classes = tone === 'secondary'
        ? 'border-sky-200 bg-sky-50 text-sky-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';

    return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold ${classes}`}>{children}</span>;
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
        <form className={compactDensity.formStack} onSubmit={handleSubmit}>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.groupName}</span>
                <input aria-label={t.coa.groupName} value={name} onChange={(event) => setName(event.target.value)} required className={compactDensity.formField} placeholder={t.coa.currentAssets} />
            </label>
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.groupType}</span>
                <select aria-label={t.coa.groupType} value={type} onChange={(event) => setType(event.target.value as AccountType)} className={compactDensity.formField}>
                    {ACCOUNT_TYPES.map((option) => <option key={option} value={option}>{t.accountingShared.accountTypes[option]}</option>)}
                </select>
            </label>
            <button type="submit" disabled={saving} className={`${compactDensity.btnPrimary} bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60`}>
                <Plus className="w-3.5 h-3.5" />
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
        <form className={compactDensity.formStack} onSubmit={handleSubmit}>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.parentGroup}</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required className={compactDensity.formField}>
                    <option value="">{t.coa.selectGroup}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
            </label>
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.subgroupName}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required className={compactDensity.formField} placeholder={t.coa.cashAndBank} />
            </label>
            <button type="submit" disabled={saving} className={`${compactDensity.btnPrimary} bg-primary text-white hover:bg-primary-hover disabled:opacity-60`}>
                <Plus className="w-3.5 h-3.5" />
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
        <form className={compactDensity.formStack} onSubmit={handleSubmit}>
            {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div> : null}
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.accountGroup}</span>
                <select value={groupId} onChange={(event) => setGroupId(event.target.value)} required className={compactDensity.formField}>
                    <option value="">{t.coa.selectGroup}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                </select>
            </label>
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.accountSubgroup}</span>
                <select value={subgroupId} onChange={(event) => setSubgroupId(event.target.value)} className={compactDensity.formField}>
                    <option value="">{t.accountingShared.optional}</option>
                    {filteredSubgroups.map((subgroup) => <option key={subgroup.id} value={subgroup.id}>{subgroup.name}</option>)}
                </select>
            </label>
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.accountName}</span>
                <input value={name} onChange={(event) => setName(event.target.value)} required className={compactDensity.formField} placeholder={t.coa.cashInHand} />
            </label>
            <label className="block">
                <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.accountCode}</span>
                <input value={code} onChange={(event) => setCode(event.target.value)} className={compactDensity.formField} placeholder="1010" />
            </label>
            <div className="grid grid-cols-2 gap-2">
                <label className="block">
                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.coa.accountType}</span>
                    <select value={type} onChange={(event) => setType(event.target.value as AccountType)} className={compactDensity.formField}>
                        {ACCOUNT_TYPES.map((option) => <option key={option} value={option}>{t.accountingShared.accountTypes[option]}</option>)}
                    </select>
                </label>
                <label className="block">
                    <span className={`${compactDensity.formLabel} block mb-1`}>{t.accountingShared.category}</span>
                    <select value={category} onChange={(event) => setCategory(event.target.value as AccountCategory)} className={compactDensity.formField}>
                        {ACCOUNT_CATEGORIES.map((option) => <option key={option} value={option}>{t.accountingShared.accountCategories[option]}</option>)}
                    </select>
                </label>
            </div>
            <button type="submit" disabled={saving} className={`${compactDensity.btnPrimary} bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60`}>
                <Plus className="w-3.5 h-3.5" />
                {saving ? t.coa.creating : t.coa.createAccount}
            </button>
        </form>
    );
}
import type { LucideIcon } from 'lucide-react';
import {
    AlertTriangle,
    BarChart3,
    BookOpen,
    Building2,
    Calculator,
    ClipboardList,
    Copy,
    Cpu,
    FileText,
    FolderTree,
    GitMerge,
    HandCoins,
    Landmark,
    LayoutDashboard,
    Lock,
    Receipt,
    RefreshCw,
    Scale,
    Settings,
    Target,
    TrendingUp,
    Upload,
    Wallet,
    Waves,
} from 'lucide-react';
import { routes } from '@/lib/routes';

export type AccountingLinkKey =
    | 'coa'
    | 'vouchersList'
    | 'vouchers'
    | 'journal'
    | 'ledger'
    | 'postingRules'
    | 'postingExceptions'
    | 'fiscalPeriods'
    | 'openingBalances'
    | 'costCenters'
    | 'fixedAssets'
    | 'recurringJournals'
    | 'recurringVouchers'
    | 'voucherTemplates'
    | 'bankReconciliation'
    | 'expenses'
    | 'expenseCategories'
    | 'expenseReports'
    | 'loans'
    | 'pl'
    | 'balanceSheet'
    | 'cashbook'
    | 'bankbook'
    | 'trialBalance'
    | 'comparativePl'
    | 'arAging'
    | 'apAging'
    | 'vatTax'
    | 'budgetVsActual'
    | 'cashFlow'
    | 'financialRatios';

export interface AccountingNavItem {
    key: AccountingLinkKey;
    href: string;
    icon: LucideIcon;
    accent: string;
    advancedOnly?: boolean;
}

export const ACCOUNTING_CORE_LINKS: AccountingNavItem[] = [
    { key: 'coa', href: routes.accounting.coa, icon: BookOpen, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { key: 'vouchersList', href: routes.accounting.vouchers, icon: Receipt, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { key: 'vouchers', href: routes.accounting.voucherEntry, icon: FileText, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
    { key: 'journal', href: routes.accounting.journal, icon: ClipboardList, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { key: 'ledger', href: routes.accounting.ledger, icon: BookOpen, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
    { key: 'postingRules', href: routes.accounting.postingRules, icon: Settings, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { key: 'postingExceptions', href: routes.accounting.reconciliation, icon: AlertTriangle, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { key: 'fiscalPeriods', href: routes.accounting.fiscalPeriods, icon: Lock, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
    { key: 'openingBalances', href: routes.accounting.openingBalances, icon: Upload, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
    { key: 'costCenters', href: routes.accounting.costCenters, icon: Building2, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
    { key: 'fixedAssets', href: routes.accounting.fixedAssets, icon: Cpu, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
    { key: 'recurringJournals', href: routes.accounting.recurringJournals, icon: RefreshCw, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
    { key: 'recurringVouchers', href: routes.accounting.recurringVouchers, icon: RefreshCw, accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
    { key: 'voucherTemplates', href: routes.accounting.voucherTemplates, icon: Copy, accent: 'bg-lime-50 text-lime-700 border-lime-100' },
    { key: 'bankReconciliation', href: routes.accounting.reconciliationBank, icon: GitMerge, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
];

export const ACCOUNTING_REPORT_LINKS: AccountingNavItem[] = [
    { key: 'pl', href: routes.accounting.reports.pl, icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { key: 'balanceSheet', href: routes.accounting.reports.balanceSheet, icon: LayoutDashboard, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { key: 'cashbook', href: routes.accounting.reports.cashbook, icon: BookOpen, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { key: 'bankbook', href: routes.accounting.reports.bankbook, icon: Landmark, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
    { key: 'trialBalance', href: routes.accounting.reports.trialBalance, icon: Scale, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
    { key: 'comparativePl', href: routes.accounting.reports.comparativePl, icon: BarChart3, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100', advancedOnly: true },
    { key: 'arAging', href: routes.accounting.reports.arAging, icon: Calculator, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { key: 'apAging', href: routes.accounting.reports.apAging, icon: Calculator, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { key: 'vatTax', href: routes.accounting.reports.vatTax, icon: FileText, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { key: 'budgetVsActual', href: routes.accounting.reports.budgetVsActual, icon: Target, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100', advancedOnly: true },
    { key: 'cashFlow', href: routes.accounting.reports.cashFlow, icon: Waves, accent: 'bg-teal-50 text-teal-700 border-teal-100', advancedOnly: true },
    { key: 'financialRatios', href: routes.accounting.reports.financialRatios, icon: Calculator, accent: 'bg-purple-50 text-purple-700 border-purple-100', advancedOnly: true },
];

export const ACCOUNTING_TRANSACTION_LINKS: AccountingNavItem[] = [
    { key: 'expenses', href: routes.accounting.expenses, icon: Receipt, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { key: 'expenseCategories', href: routes.accounting.expenseCategories, icon: FolderTree, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
    { key: 'expenseReports', href: routes.accounting.expenseReports, icon: BarChart3, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { key: 'loans', href: routes.accounting.loans, icon: HandCoins, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
];

export const ACCOUNTING_SETUP_LINKS: AccountingNavItem[] = [
    { key: 'coa', href: routes.accounting.coa, icon: FolderTree, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    { key: 'postingRules', href: routes.accounting.postingRules, icon: Settings, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
    { key: 'fiscalPeriods', href: routes.accounting.fiscalPeriods, icon: Lock, accent: 'bg-slate-50 text-slate-700 border-slate-100' },
    { key: 'openingBalances', href: routes.accounting.openingBalances, icon: Upload, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
    { key: 'costCenters', href: routes.accounting.costCenters, icon: Building2, accent: 'bg-cyan-50 text-cyan-700 border-cyan-100' },
    { key: 'fixedAssets', href: routes.accounting.fixedAssets, icon: Cpu, accent: 'bg-orange-50 text-orange-700 border-orange-100' },
    { key: 'recurringJournals', href: routes.accounting.recurringJournals, icon: RefreshCw, accent: 'bg-purple-50 text-purple-700 border-purple-100' },
    { key: 'recurringVouchers', href: routes.accounting.recurringVouchers, icon: RefreshCw, accent: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100' },
    { key: 'voucherTemplates', href: routes.accounting.voucherTemplates, icon: Copy, accent: 'bg-lime-50 text-lime-700 border-lime-100' },
];

export const ACCOUNTING_RECONCILIATION_LINKS: AccountingNavItem[] = [
    { key: 'postingExceptions', href: routes.accounting.reconciliation, icon: AlertTriangle, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    { key: 'bankReconciliation', href: routes.accounting.reconciliationBank, icon: GitMerge, accent: 'bg-blue-50 text-blue-700 border-blue-100' },
];

export const ACCOUNTING_DAILY_LINKS: AccountingNavItem[] = [
    { key: 'vouchers', href: routes.accounting.voucherEntry, icon: FileText, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
    { key: 'vouchersList', href: routes.accounting.vouchers, icon: Receipt, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
    { key: 'journal', href: routes.accounting.journal, icon: ClipboardList, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
    { key: 'ledger', href: routes.accounting.ledger, icon: BookOpen, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
];

type AccountingNavMessages = {
    accounting: {
        links: Record<AccountingLinkKey, { title: string; description: string }>;
        hub: {
            transactions: string;
            reconciliation: string;
        };
    };
    sidebar: {
        items: { overview: string };
        sections: {
            accountingReports: string;
            accountingSetup: string;
        };
    };
};

export interface AccountingSidebarNavLink {
    href: string;
    icon: LucideIcon;
    label: string;
    exact?: boolean;
    advancedOnly?: boolean;
}

export interface AccountingSidebarNavSubgroup {
    type: 'subgroup';
    key: string;
    icon: LucideIcon;
    label: string;
    children: AccountingSidebarNavLink[];
}

export type AccountingSidebarNavChild = AccountingSidebarNavLink | AccountingSidebarNavSubgroup;

function toSidebarLink(
    t: AccountingNavMessages,
    item: AccountingNavItem,
): AccountingSidebarNavLink {
    return {
        href: item.href,
        icon: item.icon,
        label: t.accounting.links[item.key].title,
        advancedOnly: item.advancedOnly,
    };
}

export function buildAccountingSidebarChildren(t: AccountingNavMessages): AccountingSidebarNavChild[] {
    return [
        { href: routes.accounting.root, icon: LayoutDashboard, label: t.sidebar.items.overview, exact: true },
        ...ACCOUNTING_DAILY_LINKS.map((item) => toSidebarLink(t, item)),
        {
            type: 'subgroup',
            key: 'transactions',
            icon: Wallet,
            label: t.accounting.hub.transactions,
            children: ACCOUNTING_TRANSACTION_LINKS.map((item) => toSidebarLink(t, item)),
        },
        {
            type: 'subgroup',
            key: 'reconciliation',
            icon: GitMerge,
            label: t.accounting.hub.reconciliation,
            children: ACCOUNTING_RECONCILIATION_LINKS.map((item) => toSidebarLink(t, item)),
        },
        {
            type: 'subgroup',
            key: 'reports',
            icon: BarChart3,
            label: t.sidebar.sections.accountingReports,
            children: ACCOUNTING_REPORT_LINKS.map((item) => toSidebarLink(t, item)),
        },
        {
            type: 'subgroup',
            key: 'setup',
            icon: Settings,
            label: t.sidebar.sections.accountingSetup,
            children: ACCOUNTING_SETUP_LINKS.map((item) => toSidebarLink(t, item)),
        },
    ];
}
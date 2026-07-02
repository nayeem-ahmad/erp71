'use client';

import Link from 'next/link';
import {
    BookOpen,
    ClipboardList,
    FileText,
    HandCoins,
    ReceiptText,
    TrendingUp,
    Wallet,
    type LucideIcon,
} from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';
import { compactDensity } from '@/lib/ui/compact-density';

type QuickLink = {
    key: string;
    href: string;
    label: string;
    icon: LucideIcon;
    accent: string;
};

type FrequentQuickLinksProps = {
    accountingOnlyMode?: boolean;
};

export default function FrequentQuickLinks({ accountingOnlyMode = false }: FrequentQuickLinksProps) {
    const { t } = useI18n();
    const copy = t.dashboardHome;
    const accountingCopy = t.accounting.links;

    const retailLinks: QuickLink[] = [
        { key: 'sales-entry', href: '/sales/new', label: copy.quickLinks.salesEntry, icon: FileText, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
        { key: 'sales', href: '/sales', label: copy.quickLinks.sales, icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        { key: 'customer-payment', href: '/sales/customer-payments', label: copy.quickLinks.customerPayment, icon: Wallet, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
        { key: 'supplier-payment', href: '/purchases/supplier-payments', label: copy.quickLinks.supplierPayment, icon: Wallet, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
        { key: 'customer-ledger', href: '/sales/customer-ledger', label: copy.quickLinks.customerLedger, icon: BookOpen, accent: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
        { key: 'expense-entry', href: '/accounting/expenses?new=1', label: copy.quickLinks.expenseEntry, icon: ReceiptText, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
    ];

    const accountingLinks: QuickLink[] = [
        { key: 'vouchers', href: routes.accounting.voucherEntry, label: accountingCopy.vouchers.title, icon: FileText, accent: 'bg-teal-50 text-teal-700 border-teal-100' },
        { key: 'expenses', href: `${routes.accounting.expenses}?new=1`, label: accountingCopy.expenses.title, icon: ReceiptText, accent: 'bg-rose-50 text-rose-700 border-rose-100' },
        { key: 'ledger', href: routes.accounting.ledger, label: accountingCopy.ledger.title, icon: BookOpen, accent: 'bg-violet-50 text-violet-700 border-violet-100' },
        { key: 'journal', href: routes.accounting.journal, label: accountingCopy.journal.title, icon: ClipboardList, accent: 'bg-sky-50 text-sky-700 border-sky-100' },
        { key: 'pl', href: routes.accounting.reports.pl, label: accountingCopy.pl.title, icon: TrendingUp, accent: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
        { key: 'loans', href: routes.accounting.loans, label: accountingCopy.loans.title, icon: HandCoins, accent: 'bg-amber-50 text-amber-700 border-amber-100' },
    ];

    const links = accountingOnlyMode ? accountingLinks : retailLinks;

    return (
        <div>
            <p className={`${compactDensity.sectionLabel} mb-2`}>{copy.quickActions}</p>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
                {links.map(({ key, href, label, icon: Icon, accent }) => (
                    <Link
                        key={key}
                        href={href}
                        className="group flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-2.5 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50"
                    >
                        <span className={`inline-flex rounded-md border p-1.5 ${accent}`}>
                            <Icon className="h-4 w-4" />
                        </span>
                        <span className="text-center text-[11px] font-semibold leading-tight text-gray-900">{label}</span>
                    </Link>
                ))}
            </div>
        </div>
    );
}
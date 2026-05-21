import Link from 'next/link';
import { ArrowRight, BookOpen, Calculator, ClipboardList, FileText, Settings, AlertTriangle } from 'lucide-react';
import { HelpTooltip } from '@/components/HelpTooltip';

const ACCOUNTING_LINKS = [
    {
        href: '/dashboard/accounting/coa',
        title: 'Chart of Accounts',
        description: 'Define account structure for assets, liabilities, equity, revenue, and expense heads.',
        icon: BookOpen,
        accent: 'bg-amber-50 text-amber-700 border-amber-100',
    },
    {
        href: '/dashboard/accounting/vouchers',
        title: 'Voucher Entry',
        description: 'Prepare cash, bank, transfer, and journal voucher workflows for upcoming posting stories.',
        icon: FileText,
        accent: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    },
    {
        href: '/dashboard/accounting/journal',
        title: 'Journal',
        description: 'Review voucher activity chronologically once voucher posting is enabled.',
        icon: ClipboardList,
        accent: 'bg-sky-50 text-sky-700 border-sky-100',
    },
    {
        href: '/dashboard/accounting/ledger',
        title: 'Ledger',
        description: 'Navigate into account-level running balances and audit trails from a single report hub.',
        icon: Calculator,
        accent: 'bg-violet-50 text-violet-700 border-violet-100',
    },
    {
        href: '/dashboard/accounting/posting-rules',
        title: 'Posting Rules',
        description: 'Configure which accounts are debited and credited for each operational event type.',
        icon: Settings,
        accent: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    },
    {
        href: '/dashboard/accounting/reconciliation',
        title: 'Posting Exceptions',
        description: 'Monitor and retry failed or skipped auto-posting events for reconciliation.',
        icon: AlertTriangle,
        accent: 'bg-rose-50 text-rose-700 border-rose-100',
    },
];

export default function AccountingPage() {
    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-6 font-sans text-gray-900">
            <div className="max-w-[1200px] mx-auto space-y-6">
                <div className="space-y-2">
                    <p className="text-xs font-black uppercase tracking-[0.24em] text-gray-400">Accounting Module</p>
                    <div className="flex items-end justify-between gap-6 flex-wrap">
                        <div>
                            <h1 className="text-3xl font-black tracking-tight text-gray-950 inline-flex items-center gap-2">Financial Ledgers & Core Accounting <HelpTooltip text="The Chart of Accounts (COA) organises all your financial accounts. Assets, liabilities, income, and expenses each have their own account codes used in journal entries." /></h1>
                            <p className="text-sm text-gray-500 max-w-3xl mt-2">
                                The accounting foundation is live. Use these entry points to configure the Chart of Accounts,
                                prepare vouchers, review the journal flow, and drill into ledger reporting as the next stories land.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                            <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-500">Epic 30</p>
                            <p className="text-sm font-bold text-blue-900">Foundation routes and access controls are enabled</p>
                        </div>
                    </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {ACCOUNTING_LINKS.map(({ href, title, description, icon: Icon, accent }) => (
                        <Link
                            key={title}
                            href={href}
                            className="group rounded-3xl border border-gray-200 bg-white p-5 shadow-sm transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
                        >
                            <div className={`inline-flex rounded-2xl border px-3 py-3 ${accent}`}>
                                <Icon className="h-5 w-5" />
                            </div>
                            <div className="mt-5 space-y-2">
                                <h2 className="text-lg font-black tracking-tight text-gray-950">{title}</h2>
                                <p className="text-sm leading-6 text-gray-500">{description}</p>
                            </div>
                            <div className="mt-5 flex items-center text-sm font-bold text-gray-900">
                                Open section
                                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
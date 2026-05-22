'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, BookOpen, Calculator, ClipboardList, Download, FileText, Settings, AlertTriangle, ChevronDown } from 'lucide-react';
import { HelpTooltip } from '@/components/HelpTooltip';
import { api } from '@/lib/api';

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

type ExportFormat = 'tally' | 'quickbooks';

function getDefaultDateRange() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const from = `${year}-${month}-01`;
    const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
    const to = `${year}-${month}-${String(lastDay).padStart(2, '0')}`;
    return { from, to };
}

function triggerBlobDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

export default function AccountingPage() {
    const defaults = getDefaultDateRange();

    const [showExportMenu, setShowExportMenu] = useState(false);
    const [showDateModal, setShowDateModal] = useState(false);
    const [pendingFormat, setPendingFormat] = useState<ExportFormat | null>(null);
    const [from, setFrom] = useState(defaults.from);
    const [to, setTo] = useState(defaults.to);
    const [exporting, setExporting] = useState(false);
    const [exportError, setExportError] = useState<string | null>(null);

    const exportMenuRef = useRef<HTMLDivElement>(null);

    function openExportModal(format: ExportFormat) {
        setPendingFormat(format);
        setShowExportMenu(false);
        setExportError(null);
        setShowDateModal(true);
    }

    async function handleExport() {
        if (!pendingFormat) return;
        setExporting(true);
        setExportError(null);
        try {
            const { blob, filename } = await api.exportAccountingLedger({
                format: pendingFormat,
                from: from || undefined,
                to: to || undefined,
            });
            triggerBlobDownload(blob, filename);
            setShowDateModal(false);
        } catch (err: any) {
            setExportError(err?.message ?? 'Export failed. Please try again.');
        } finally {
            setExporting(false);
        }
    }

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
                        <div className="flex items-center gap-3 flex-wrap">
                            {/* Export dropdown */}
                            <div className="relative" ref={exportMenuRef}>
                                <button
                                    onClick={() => setShowExportMenu((v) => !v)}
                                    className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 shadow-sm transition hover:bg-gray-50 hover:shadow"
                                >
                                    <Download className="h-4 w-4" />
                                    Export
                                    <ChevronDown className="h-3.5 w-3.5 text-gray-400" />
                                </button>
                                {showExportMenu && (
                                    <div
                                        className="absolute right-0 z-20 mt-1 w-44 rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
                                        onMouseLeave={() => setShowExportMenu(false)}
                                    >
                                        <button
                                            onClick={() => openExportModal('tally')}
                                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            Tally XML
                                        </button>
                                        <button
                                            onClick={() => openExportModal('quickbooks')}
                                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                                        >
                                            QuickBooks IIF
                                        </button>
                                    </div>
                                )}
                            </div>

                            <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-right">
                                <p className="text-[11px] font-black uppercase tracking-[0.24em] text-blue-500">Epic 30</p>
                                <p className="text-sm font-bold text-blue-900">Foundation routes and access controls are enabled</p>
                            </div>
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

            {/* Date-range modal */}
            {showDateModal && (
                <div
                    className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm"
                    onClick={(e) => { if (e.target === e.currentTarget) setShowDateModal(false); }}
                >
                    <div className="w-full max-w-sm rounded-3xl border border-gray-200 bg-white p-6 shadow-2xl">
                        <h2 className="text-lg font-black tracking-tight text-gray-950 mb-1">
                            Export {pendingFormat === 'tally' ? 'Tally XML' : 'QuickBooks IIF'}
                        </h2>
                        <p className="text-sm text-gray-500 mb-5">
                            Select the date range for vouchers to include. Leave blank to export all.
                        </p>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                                    From
                                </label>
                                <input
                                    type="date"
                                    value={from}
                                    onChange={(e) => setFrom(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                                    To
                                </label>
                                <input
                                    type="date"
                                    value={to}
                                    onChange={(e) => setTo(e.target.value)}
                                    className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                        </div>

                        {exportError && (
                            <p className="mt-3 text-sm text-red-600">{exportError}</p>
                        )}

                        <div className="mt-6 flex gap-3 justify-end">
                            <button
                                onClick={() => setShowDateModal(false)}
                                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50 transition"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleExport}
                                disabled={exporting}
                                className="inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-60 transition"
                            >
                                <Download className="h-4 w-4" />
                                {exporting ? 'Downloading…' : 'Download'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

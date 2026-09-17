'use client';

import { useState, useEffect } from 'react';
import { Clock, DollarSign, ArrowDownCircle, ArrowUpCircle, CheckCircle, AlertCircle, Monitor, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT, formatDateTime } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';
import PageHeader from '@/components/ui/compact/PageHeader';
import { modulePageBreadcrumbs } from '@/lib/page-breadcrumbs';
import { PageShell, Button } from '@/components/ui';
import ModalShell, { ModalHeader, ModalFooter } from '@/components/ModalShell';
import { getWorkspaceItem } from '@/lib/session-store';
import { toast } from '@/lib/toast';

export default function CashierSessionsPage() {
    const { t, locale } = useI18n();
    const [session, setSession] = useState<any>(null);
    const [transactions, setTransactions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [openingCash, setOpeningCash] = useState<number>(0);
    const [closingCash, setClosingCash] = useState<number>(0);
    const [txAmount, setTxAmount] = useState<number>(0);
    const [txType, setTxType] = useState('DROP');
    const [txDescription, setTxDescription] = useState('');
    const [showOpenModal, setShowOpenModal] = useState(false);
    const [showCloseModal, setShowCloseModal] = useState(false);
    const [showTxModal, setShowTxModal] = useState(false);
    const [counters, setCounters] = useState<any[]>([]);
    const [selectedCounterId, setSelectedCounterId] = useState<string>('');
    // What the shift actually took, from the API. The page used to compute
    // "expected cash" in the browser as opening + cash in − cash out, which
    // leaves out every cash sale — so a till that had sold anything always
    // read short by exactly its takings.
    const [summary, setSummary] = useState<any>(null);
    const [openTills, setOpenTills] = useState<any[]>([]);

    useEffect(() => {
        loadSession();
        loadCounters();
        loadOpenTills();
    }, []);

    const loadSession = async () => {
        try {
            const data = await api.getOpenCashierSession();
            setSession(data);
            if (data?.id) {
                const [txData, summaryData] = await Promise.all([
                    api.getCashTransactions(data.id),
                    api.getCashierSessionSummary(data.id).catch(() => null),
                ]);
                setTransactions(txData);
                setSummary(summaryData);
            } else {
                setSummary(null);
            }
        } catch (error) {
            console.error('Failed to load session', error);
            setSession(null);
        } finally {
            setLoading(false);
        }
    };

    // The floor view. Anyone who may open a session may see the tills beside
    // theirs — a cashier needs to know counter 2 is already taken, and it is
    // the only way a supervisor sees the shop at all.
    const loadOpenTills = async () => {
        try {
            const storeId = getWorkspaceItem('store_id') || '';
            if (!storeId) return;
            const data = await api.getOpenCashierSessionsByStore(storeId);
            setOpenTills(Array.isArray(data) ? data : []);
        } catch {
            // Non-fatal: the panel is additional context, not the page.
        }
    };

    const loadCounters = async () => {
        try {
            const storeId = getWorkspaceItem('store_id') || '';
            if (!storeId) return;
            const data = await api.getActiveCounters(storeId);
            const list = Array.isArray(data) ? data : (data?.data ?? []);
            setCounters(list);
        } catch {
            // counters are optional — silently ignore if not available
        }
    };

    const handleOpenSession = async () => {
        try {
            const storeId = getWorkspaceItem('store_id') || '';
            const payload: any = { storeId, openingCash };
            if (selectedCounterId) payload.counterId = selectedCounterId;
            await api.openCashierSession(payload);
            if (selectedCounterId) {
                localStorage.setItem('counter_id', selectedCounterId);
            } else {
                localStorage.removeItem('counter_id');
            }
            setShowOpenModal(false);
            setOpeningCash(0);
            setSelectedCounterId('');
            loadSession();
            loadOpenTills();
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.openSession);
        }
    };

    const handleCloseSession = async () => {
        if (!session) return;
        try {
            await api.closeCashierSession(session.id, { closingCash });
            localStorage.removeItem('counter_id');
            setShowCloseModal(false);
            setClosingCash(0);
            setSession(null);
            setTransactions([]);
            setSummary(null);
            loadSession();
            loadOpenTills();
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.closeSession);
        }
    };

    const handleAddTransaction = async () => {
        if (!session) return;
        try {
            await api.addCashTransaction(session.id, {
                amount: txAmount,
                type: txType,
                description: txDescription,
            });
            setShowTxModal(false);
            setTxAmount(0);
            setTxType('DROP');
            setTxDescription('');
            const [txData, summaryData] = await Promise.all([
                api.getCashTransactions(session.id),
                api.getCashierSessionSummary(session.id).catch(() => null),
            ]);
            setTransactions(txData);
            setSummary(summaryData);
        } catch (error: any) {
            toast.error(error.message || t.shared.errors.addTransaction);
        }
    };

    const totalCashIn = transactions.filter((tx) => parseFloat(tx.amount) > 0).reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    const totalCashOut = transactions.filter((tx) => parseFloat(tx.amount) < 0).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    // The server is the only thing that knows what the till sold, so the local
    // arithmetic is a placeholder for the moment before the summary lands —
    // never a second opinion about it.
    const expectedCash = summary
        ? Number(summary.expectedCash)
        : parseFloat(session?.opening_cash || 0) + totalCashIn - totalCashOut;
    const difference = closingCash - expectedCash;

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-canvas">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <PageShell>
                <PageHeader
                    title={t.cashierSessions.title}
                    subtitle={t.cashierSessions.subtitle}
                    breadcrumbs={modulePageBreadcrumbs(
                        t.dashboardHome.breadcrumbHome,
                        t.sidebar.modules.sales,
                        t.cashierSessions.title,
                        'sales',
                    )}
                    actions={
                        !session ? (
                            <button
                                onClick={() => setShowOpenModal(true)}
                                className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-lg text-sm font-semibold shadow-lg flex items-center space-x-2 rtl:space-x-reverse transition-all"
                            >
                                <Clock className="w-5 h-5" />
                                <span>{t.cashierSessions.openShift}</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => setShowCloseModal(true)}
                                className="bg-danger hover:bg-red-700 text-white px-6 py-3 rounded-lg text-sm font-semibold shadow-lg flex items-center space-x-2 rtl:space-x-reverse transition-all"
                            >
                                <Clock className="w-5 h-5" />
                                <span>{t.cashierSessions.closeShift}</span>
                            </button>
                        )
                    }
                />

                {/* Session Status */}
                {session ? (
                    <>
                        <div className="bg-white rounded-lg shadow-sm p-6 border border-green-100">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center space-x-3 rtl:space-x-reverse">
                                    <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                        <CheckCircle className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold tracking-tight">{t.cashierSessions.sessionActive}</h2>
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                            {formatMessage(t.cashierSessions.opened, { date: formatDateTime(session.opened_at) })}
                                        </p>
                                    </div>
                                </div>
                                {session.counter && (
                                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                                        <Monitor className="w-4 h-4 text-blue-500" />
                                        <div>
                                            <span className="text-[10px] font-semibold text-blue-400 block">{t.cashierSessions.counter}</span>
                                            <span className="text-sm font-bold text-blue-700">{session.counter.name}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-50 p-4 rounded-lg">
                                    <span className="text-xs font-medium text-gray-500 block mb-1">{t.cashierSessions.openingCash}</span>
                                    <span className="text-xl font-bold text-gray-900">{formatBDT(parseFloat(session.opening_cash), { locale })}</span>
                                </div>
                                <div className="bg-green-50 p-4 rounded-lg">
                                    <span className="text-[10px] font-semibold text-green-500 block mb-1">{t.cashierSessions.cashIn}</span>
                                    <span className="text-xl font-bold text-green-600">{formatBDT(totalCashIn, { locale })}</span>
                                </div>
                                <div className="bg-danger-light p-4 rounded-lg">
                                    <span className="text-[10px] font-semibold text-red-400 block mb-1">{t.cashierSessions.cashOut}</span>
                                    <span className="text-xl font-bold text-danger">{formatBDT(totalCashOut, { locale })}</span>
                                </div>
                            </div>
                        </div>

                        {/* What the shift has taken so far. Sales are the half
                            of a till's day that this page could not see. */}
                        {summary && (
                            <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
                                <h3 className="text-lg font-bold tracking-tight">{t.cashierSessions.shiftSummary}</h3>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.cashierSessions.takings}</span>
                                        <span className="text-lg font-bold text-gray-900">{formatBDT(Number(summary.salesTotal), { locale })}</span>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.cashierSessions.cashSales}</span>
                                        <span className="text-lg font-bold text-gray-900">{formatBDT(Number(summary.cashTakings), { locale })}</span>
                                    </div>
                                    <div className="bg-gray-50 p-3 rounded-lg">
                                        <span className="text-xs font-medium text-gray-500 block mb-1">{t.cashierSessions.refunds}</span>
                                        <span className="text-lg font-bold text-gray-900">{formatBDT(Number(summary.refunds), { locale })}</span>
                                    </div>
                                    <div className="bg-blue-50 p-3 rounded-lg">
                                        <span className="text-xs font-medium text-blue-500 block mb-1">{t.cashierSessions.expectedCash}</span>
                                        <span className="text-lg font-bold text-blue-600">{formatBDT(Number(summary.expectedCash), { locale })}</span>
                                    </div>
                                </div>
                                {summary.paymentBreakdown?.length > 0 && (
                                    <div>
                                        <span className="text-xs font-medium text-gray-500 block mb-2">{t.cashierSessions.paymentBreakdown}</span>
                                        <div className="flex flex-wrap gap-2">
                                            {summary.paymentBreakdown.map((row: any) => (
                                                <span key={row.method} className="text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                                                    <span className="font-semibold text-gray-700">{row.method}</span>
                                                    <span className="ms-2 text-gray-500">{formatBDT(Number(row.amount), { locale })}</span>
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <span className="block text-xs text-gray-400">
                                    {t.cashierSessions.salesCount}: {summary.salesCount}
                                </span>
                            </div>
                        )}

                        {/* Add Cash Transaction */}
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowTxModal(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-xs font-semibold shadow-md flex items-center space-x-2 rtl:space-x-reverse transition-all"
                            >
                                <DollarSign className="w-4 h-4" />
                                <span>{t.cashierSessions.recordCashInOut}</span>
                            </button>
                        </div>

                        {/* Transactions List */}
                        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-gray-100">
                                <h3 className="text-lg font-bold tracking-tight">{t.cashierSessions.cashTransactions}</h3>
                            </div>
                            {transactions.length === 0 ? (
                                <div className="p-8 text-center text-gray-300">
                                    <DollarSign className="w-12 h-12 mx-auto opacity-20 mb-2" />
                                    <p className="text-xs font-semibold">{t.shared.empty.noTransactions}</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {transactions.map((tx) => (
                                        <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                                            <div className="flex items-center space-x-3 rtl:space-x-reverse">
                                                {parseFloat(tx.amount) > 0 ? (
                                                    <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                                        <ArrowDownCircle className="w-5 h-5" />
                                                    </div>
                                                ) : (
                                                    <div className="p-2 bg-danger-light rounded-xl text-danger">
                                                        <ArrowUpCircle className="w-5 h-5" />
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="text-sm font-bold text-gray-900 block">{tx.type}</span>
                                                    <span className="text-xs text-gray-400">{tx.description || t.shared.dash}</span>
                                                </div>
                                            </div>
                                            <div className="text-end">
                                                <span className={`text-sm font-bold ${parseFloat(tx.amount) > 0 ? 'text-green-600' : 'text-danger'}`}>
                                                    {parseFloat(tx.amount) > 0 ? '+' : ''}{formatBDT(parseFloat(tx.amount), { locale })}
                                                </span>
                                                <span className="text-[10px] text-gray-400 block">{new Date(tx.created_at).toLocaleTimeString()}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                ) : (
                    <div className="bg-white rounded-lg shadow-sm p-12 text-center">
                        <AlertCircle className="w-16 h-16 mx-auto text-gray-200 mb-4" />
                        <h2 className="text-lg font-bold tracking-tight text-gray-400">{t.cashierSessions.noActiveSession}</h2>
                        <p className="text-xs font-bold text-gray-300 uppercase tracking-widest mt-1">{t.cashierSessions.noActiveSessionHint}</p>
                    </div>
                )}
            

            {/* Every till open in this branch. The API for this has existed
                since counters shipped and nothing ever called it, so an owner
                with three counters running could not see any of them. */}
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
                <div className="p-6 border-b border-gray-100">
                    <h3 className="text-lg font-bold tracking-tight flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-600" />
                        {t.cashierSessions.openTills}
                    </h3>
                    <p className="text-xs text-gray-400 mt-1">{t.cashierSessions.openTillsSubtitle}</p>
                </div>
                {openTills.length === 0 ? (
                    <div className="p-8 text-center text-gray-300">
                        <Monitor className="w-12 h-12 mx-auto opacity-20 mb-2" />
                        <p className="text-xs font-semibold">{t.cashierSessions.noOpenTills}</p>
                    </div>
                ) : (
                    <div className="divide-y divide-gray-50">
                        {openTills.map((till: any) => (
                            <div key={till.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50/50 transition-colors">
                                <div className="flex items-center gap-3">
                                    <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
                                        <Monitor className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <span className="text-sm font-bold text-gray-900 block">
                                            {till.counter ? `#${till.counter.counter_number} — ${till.counter.name}` : t.shared.form.walkInNoCounter}
                                        </span>
                                        <span className="text-xs text-gray-400">
                                            {till.user?.name ?? t.shared.dash} · {formatDateTime(till.opened_at)}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4 text-end">
                                    <div>
                                        <span className="text-[10px] font-semibold text-gray-400 block">{t.cashierSessions.takings}</span>
                                        <span className="text-sm font-bold text-gray-900">
                                            {formatBDT(Number(till.summary?.salesTotal ?? 0), { locale })}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-semibold text-blue-400 block">{t.cashierSessions.expectedCash}</span>
                                        <span className="text-sm font-bold text-blue-600">
                                            {formatBDT(Number(till.summary?.expectedCash ?? 0), { locale })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Open Session Modal */}
            {showOpenModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowOpenModal(false)}>
                        <ModalHeader title={t.cashierSessions.openShiftTitle} onClose={() => setShowOpenModal(false)} />
                        <div className="p-6 space-y-4 overflow-y-auto">
                            {counters.length > 0 && (
                                <div className="space-y-2">
                                    <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.counter}</label>
                                    <select
                                        value={selectedCounterId}
                                        onChange={(e) => setSelectedCounterId(e.target.value)}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-gray-900 focus:ring-2 focus:ring-green-500/20 focus:bg-white transition-all shadow-sm"
                                    >
                                        <option value="">{t.shared.form.walkInNoCounter}</option>
                                        {counters.map((c) => (
                                            <option key={c.id} value={c.id}>#{c.counter_number} — {c.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.openingCashAmount}</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={openingCash || ''}
                                    onChange={(e) => setOpeningCash(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-gray-900 focus:ring-2 focus:ring-green-500/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.amountPlaceholder}
                                />
                            </div>
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="primary" size="md" className="w-full justify-center" onClick={handleOpenSession}>
                                Open Shift
                            </Button>
                        </ModalFooter>
                </ModalShell>
            )}

            {/* Close Session Modal */}
            {showCloseModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowCloseModal(false)}>
                        <ModalHeader title={t.cashierSessions.closeShiftTitle} onClose={() => setShowCloseModal(false)} />
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                <span className="text-[10px] font-semibold text-blue-400 block mb-1">{t.cashierSessions.expectedCash}</span>
                                <span className="text-2xl font-bold text-blue-600">
                                    {formatBDT(expectedCash, { locale })}
                                </span>
                                <span className="block mt-1 text-[11px] text-blue-400">{t.cashierSessions.expectedCashHint}</span>
                                {summary && (
                                    <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-blue-500">
                                        <span>{t.cashierSessions.openingCash}: {formatBDT(Number(summary.openingCash), { locale })}</span>
                                        <span>{t.cashierSessions.cashSales}: {formatBDT(Number(summary.cashTakings), { locale })}</span>
                                        <span>{t.cashierSessions.refunds}: {formatBDT(Number(summary.refunds), { locale })}</span>
                                        <span>{t.cashierSessions.cashIn}/{t.cashierSessions.cashOut}: {formatBDT(Number(summary.cashIn) - Number(summary.cashOut), { locale })}</span>
                                    </div>
                                )}
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.actualClosingCash}</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={closingCash || ''}
                                    onChange={(e) => setClosingCash(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-gray-900 focus:ring-2 focus:ring-danger/20/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.amountPlaceholder}
                                />
                            </div>
                            {closingCash > 0 && (
                                <div className={`p-3 rounded-lg ${Math.abs(difference) < 0.01 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                                    <span className="text-[10px] font-semibold block mb-1">
                                        {Math.abs(difference) < 0.01
                                            ? t.cashierSessions.balanced
                                            : difference > 0
                                                ? t.cashierSessions.cashOver
                                                : t.cashierSessions.cashShort}
                                    </span>
                                    <span className="text-lg font-bold">
                                        {formatBDT(difference, { locale })}
                                    </span>
                                </div>
                            )}
                        </div>
                        <ModalFooter>
                            <Button type="button" variant="danger" size="md" className="w-full justify-center" onClick={handleCloseSession}>
                                Close Shift
                            </Button>
                        </ModalFooter>
                </ModalShell>
            )}

            {/* Cash Transaction Modal */}
            {showTxModal && (
                <ModalShell size="sm" onBackdropClick={() => setShowTxModal(false)}>
                        <ModalHeader title={t.cashierSessions.cashInOutTitle} onClose={() => setShowTxModal(false)} />
                        <div className="p-6 space-y-4 overflow-y-auto">
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.type}</label>
                                <select
                                    value={txType}
                                    onChange={(e) => setTxType(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm"
                                >
                                    <option value="DROP">{t.cashierSessions.types.drop}</option>
                                    <option value="LOAN">{t.cashierSessions.types.loan}</option>
                                    <option value="PAYOUT">{t.cashierSessions.types.payout}</option>
                                    <option value="OTHER">{t.cashierSessions.types.other}</option>
                                </select>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.shared.form.amountInOutHint}</label>
                                <input
                                    type="number"
                                    value={txAmount || ''}
                                    onChange={(e) => setTxAmount(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-bold text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.amountPlaceholder}
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.descriptionOptional}</label>
                                <input
                                    type="text"
                                    value={txDescription}
                                    onChange={(e) => setTxDescription(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-medium text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.changeDescription}
                                />
                            </div>
                        </div>
                        <ModalFooter>
                            <Button
                                type="button"
                                variant="primary"
                                size="md"
                                className="w-full justify-center"
                                onClick={handleAddTransaction}
                                disabled={txAmount === 0}
                            >
                                Record Transaction
                            </Button>
                        </ModalFooter>
                </ModalShell>
            )}
        </PageShell>
    );
}
'use client';

import { useState, useEffect } from 'react';
import { Clock, DollarSign, ArrowDownCircle, ArrowUpCircle, X, CheckCircle, AlertCircle, Monitor } from 'lucide-react';
import { api } from '@/lib/api';
import { formatBDT } from '@/lib/format';
import { useI18n, formatMessage } from '@/lib/i18n';

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

    useEffect(() => {
        loadSession();
        loadCounters();
    }, []);

    const loadSession = async () => {
        try {
            const data = await api.getOpenCashierSession();
            setSession(data);
            if (data?.id) {
                const txData = await api.getCashTransactions(data.id);
                setTransactions(txData);
            }
        } catch (error) {
            console.error('Failed to load session', error);
            setSession(null);
        } finally {
            setLoading(false);
        }
    };

    const loadCounters = async () => {
        try {
            const storeId = localStorage.getItem('store_id') || '';
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
            const storeId = localStorage.getItem('store_id') || '';
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
        } catch (error: any) {
            alert(error.message || t.shared.errors.openSession);
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
            loadSession();
        } catch (error: any) {
            alert(error.message || t.shared.errors.closeSession);
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
            const txData = await api.getCashTransactions(session.id);
            setTransactions(txData);
        } catch (error: any) {
            alert(error.message || t.shared.errors.addTransaction);
        }
    };

    const totalCashIn = transactions.filter((tx) => parseFloat(tx.amount) > 0).reduce((sum, tx) => sum + parseFloat(tx.amount), 0);
    const totalCashOut = transactions.filter((tx) => parseFloat(tx.amount) < 0).reduce((sum, tx) => sum + Math.abs(parseFloat(tx.amount)), 0);

    if (loading) {
        return (
            <div className="flex items-center justify-center h-full bg-[#f3f4f6]">
                <p className="text-gray-400 font-bold uppercase tracking-widest text-xs">{t.common.loading}</p>
            </div>
        );
    }

    return (
        <div className="overflow-y-auto h-full bg-[#f3f4f6] p-3 md:p-4 font-sans text-gray-900 text-[13px]">
            <div className="w-full space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-gray-950">{t.cashierSessions.title}</h1>
                        <p className="text-xs text-gray-500 mt-0.5">{t.cashierSessions.subtitle}</p>
                    </div>
                    {!session ? (
                        <button
                            onClick={() => setShowOpenModal(true)}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                        >
                            <Clock className="w-5 h-5" />
                            <span>{t.cashierSessions.openShift}</span>
                        </button>
                    ) : (
                        <button
                            onClick={() => setShowCloseModal(true)}
                            className="bg-rose-600 hover:bg-rose-700 text-white px-6 py-3 rounded-2xl font-black text-sm uppercase tracking-widest shadow-lg flex items-center space-x-2 transition-all hover:-translate-y-0.5"
                        >
                            <Clock className="w-5 h-5" />
                            <span>{t.cashierSessions.closeShift}</span>
                        </button>
                    )}
                </div>

                {/* Session Status */}
                {session ? (
                    <>
                        <div className="bg-white rounded-3xl shadow-sm p-6 border border-green-100">
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center space-x-3">
                                    <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                        <CheckCircle className="w-6 h-6" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-black tracking-tight">{t.cashierSessions.sessionActive}</h2>
                                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                                            {formatMessage(t.cashierSessions.opened, { date: new Date(session.opened_at).toLocaleString() })}
                                        </p>
                                    </div>
                                </div>
                                {session.counter && (
                                    <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2">
                                        <Monitor className="w-4 h-4 text-blue-500" />
                                        <div>
                                            <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 block">{t.cashierSessions.counter}</span>
                                            <span className="text-sm font-black text-blue-700">{session.counter.name}</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="bg-gray-50 p-4 rounded-2xl">
                                    <span className="text-xs font-medium text-gray-500 block mb-1">{t.cashierSessions.openingCash}</span>
                                    <span className="text-xl font-black text-gray-900">{formatBDT(parseFloat(session.opening_cash), { locale })}</span>
                                </div>
                                <div className="bg-green-50 p-4 rounded-2xl">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-green-500 block mb-1">{t.cashierSessions.cashIn}</span>
                                    <span className="text-xl font-black text-green-600">{formatBDT(totalCashIn, { locale })}</span>
                                </div>
                                <div className="bg-rose-50 p-4 rounded-2xl">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-rose-400 block mb-1">{t.cashierSessions.cashOut}</span>
                                    <span className="text-xl font-black text-rose-600">{formatBDT(totalCashOut, { locale })}</span>
                                </div>
                            </div>
                        </div>

                        {/* Add Cash Transaction */}
                        <div className="flex justify-end">
                            <button
                                onClick={() => setShowTxModal(true)}
                                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest shadow-md flex items-center space-x-2 transition-all"
                            >
                                <DollarSign className="w-4 h-4" />
                                <span>{t.cashierSessions.recordCashInOut}</span>
                            </button>
                        </div>

                        {/* Transactions List */}
                        <div className="bg-white rounded-3xl shadow-sm overflow-hidden">
                            <div className="p-6 border-b border-gray-100">
                                <h3 className="text-lg font-black tracking-tight">{t.cashierSessions.cashTransactions}</h3>
                            </div>
                            {transactions.length === 0 ? (
                                <div className="p-8 text-center text-gray-300">
                                    <DollarSign className="w-12 h-12 mx-auto opacity-20 mb-2" />
                                    <p className="text-xs font-black uppercase tracking-widest">{t.shared.empty.noTransactions}</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-gray-50">
                                    {transactions.map((tx) => (
                                        <div key={tx.id} className="p-4 flex items-center justify-between hover:bg-gray-50/50 transition-colors">
                                            <div className="flex items-center space-x-3">
                                                {parseFloat(tx.amount) > 0 ? (
                                                    <div className="p-2 bg-green-50 rounded-xl text-green-600">
                                                        <ArrowDownCircle className="w-5 h-5" />
                                                    </div>
                                                ) : (
                                                    <div className="p-2 bg-rose-50 rounded-xl text-rose-600">
                                                        <ArrowUpCircle className="w-5 h-5" />
                                                    </div>
                                                )}
                                                <div>
                                                    <span className="text-sm font-black text-gray-900 block">{tx.type}</span>
                                                    <span className="text-xs text-gray-400">{tx.description || t.shared.dash}</span>
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <span className={`text-sm font-black ${parseFloat(tx.amount) > 0 ? 'text-green-600' : 'text-rose-600'}`}>
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
                    <div className="bg-white rounded-3xl shadow-sm p-12 text-center">
                        <AlertCircle className="w-16 h-16 mx-auto text-gray-200 mb-4" />
                        <h2 className="text-lg font-black tracking-tight text-gray-400">{t.cashierSessions.noActiveSession}</h2>
                        <p className="text-xs font-bold text-gray-300 uppercase tracking-widest mt-1">{t.cashierSessions.noActiveSessionHint}</p>
                    </div>
                )}
            </div>

            {/* Open Session Modal */}
            {showOpenModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[420px] rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <h2 className="text-xl font-black tracking-tight">{t.cashierSessions.openShiftTitle}</h2>
                            <button onClick={() => setShowOpenModal(false)} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-900 transition-all">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
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
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-green-500/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.amountPlaceholder}
                                />
                            </div>
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={handleOpenSession}
                                className="w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-green-600 hover:bg-green-700 text-white shadow-lg transition-all"
                            >
                                Open Shift
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Close Session Modal */}
            {showCloseModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[420px] rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <h2 className="text-xl font-black tracking-tight">{t.cashierSessions.closeShiftTitle}</h2>
                            <button onClick={() => setShowCloseModal(false)} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-900 transition-all">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
                            <div className="bg-blue-50 p-4 rounded-2xl border border-blue-100">
                                <span className="text-[10px] font-black uppercase tracking-widest text-blue-400 block mb-1">{t.cashierSessions.expectedCash}</span>
                                <span className="text-2xl font-black text-blue-600">
                                    {formatBDT(parseFloat(session?.opening_cash || 0) + totalCashIn - totalCashOut)}
                                </span>
                            </div>
                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">{t.cashierSessions.actualClosingCash}</label>
                                <input
                                    type="number"
                                    min="0"
                                    value={closingCash || ''}
                                    onChange={(e) => setClosingCash(parseFloat(e.target.value) || 0)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-rose-500/20 focus:bg-white transition-all shadow-sm"
                                    placeholder={t.shared.form.amountPlaceholder}
                                />
                            </div>
                            {closingCash > 0 && (
                                <div className={`p-3 rounded-2xl ${Math.abs(closingCash - (parseFloat(session?.opening_cash || 0) + totalCashIn - totalCashOut)) < 0.01 ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600'}`}>
                                    <span className="text-[10px] font-black uppercase tracking-widest block mb-1">{t.cashierSessions.difference}</span>
                                    <span className="text-lg font-black">
                                        {formatBDT(closingCash - (parseFloat(session?.opening_cash || 0) + totalCashIn - totalCashOut))}
                                    </span>
                                </div>
                            )}
                        </div>
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={handleCloseSession}
                                className="w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-rose-600 hover:bg-rose-700 text-white shadow-lg transition-all"
                            >
                                Close Shift
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Cash Transaction Modal */}
            {showTxModal && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
                    <div className="bg-white w-[420px] rounded-3xl shadow-2xl overflow-hidden">
                        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <h2 className="text-xl font-black tracking-tight">{t.cashierSessions.cashInOutTitle}</h2>
                            <button onClick={() => setShowTxModal(false)} className="p-2 hover:bg-white rounded-xl text-gray-400 hover:text-gray-900 transition-all">
                                <X className="w-5 h-5" />
                            </button>
                        </div>
                        <div className="p-6 space-y-4">
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
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-4 py-3 font-black text-gray-900 focus:ring-2 focus:ring-blue-500/20 focus:bg-white transition-all shadow-sm"
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
                        <div className="p-6 bg-gray-50 border-t border-gray-100">
                            <button
                                onClick={handleAddTransaction}
                                disabled={txAmount === 0}
                                className="w-full py-3 rounded-2xl font-black text-sm uppercase tracking-widest bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Record Transaction
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../lib/api';
import { formatBDT } from '../../../../lib/format';
import { ArrowLeft, Phone, Mail, ShoppingBag, CreditCard, MapPin, Building2, FolderTree, Map, ChevronLeft, ChevronRight } from 'lucide-react';

interface PurchaseHistoryResult {
    data: any[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export default function CustomerProfile() {
    const { id } = useParams();
    const router = useRouter();
    const [customer, setCustomer] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [history, setHistory] = useState<PurchaseHistoryResult | null>(null);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyLoading, setHistoryLoading] = useState(false);

    useEffect(() => {
        if (id) void loadCustomer();
    }, [id]);

    useEffect(() => {
        if (id) void loadHistory(historyPage);
    }, [id, historyPage]);

    const loadCustomer = async () => {
        try {
            const data = await api.getCustomer(id as string);
            setCustomer(data);
        } catch (error) {
            console.error('Failed to load profile', error);
        } finally {
            setLoading(false);
        }
    };

    const loadHistory = useCallback(async (page: number) => {
        setHistoryLoading(true);
        try {
            const data = await api.getCustomerPurchaseHistory(id as string, { page, limit: 10 });
            setHistory(data);
        } catch (error) {
            console.error('Failed to load purchase history', error);
        } finally {
            setHistoryLoading(false);
        }
    }, [id]);

    if (loading) return <div className="p-8 font-black uppercase tracking-widest text-gray-400">Loading profile...</div>;
    if (!customer) return <div className="p-8 font-black text-rose-500 uppercase">Customer not found.</div>;

    const creditUtilization = customer.credit_limit && Number(customer.credit_limit) > 0
        ? ((Number(customer.total_spent) / Number(customer.credit_limit)) * 100).toFixed(1)
        : null;

    const segmentClass =
        customer.segment_category === 'VIP' ? 'bg-emerald-50 text-emerald-600' :
        customer.segment_category === 'At-Risk' ? 'bg-rose-50 text-rose-600' :
        'bg-gray-100 text-gray-600';

    return (
        <div className="overflow-y-auto h-full p-8 bg-[#f9fafb] space-y-8">
            <button onClick={() => router.back()} className="flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-4 h-4 mr-2" /> Back to Customers
            </button>

            {/* Profile Header */}
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 flex items-start space-x-6">
                <div className="w-20 h-20 bg-blue-600 rounded-2xl shadow-xl shadow-blue-500/20 flex items-center justify-center text-white font-black text-3xl uppercase overflow-hidden">
                    {customer.profile_pic_url
                        ? <img src={customer.profile_pic_url} alt={customer.name} className="w-full h-full object-cover" />
                        : customer.name.substring(0, 2)}
                </div>
                <div className="flex-1">
                    <div className="flex items-center flex-wrap gap-2">
                        <h1 className="text-3xl font-black tracking-tight">{customer.name}</h1>
                        <span className="font-mono text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">{customer.customer_code}</span>
                        <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${customer.customer_type === 'ORGANIZATION' ? 'bg-purple-50 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                            {customer.customer_type || 'Individual'}
                        </span>
                        {customer.segment_category && (
                            <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${segmentClass}`}>
                                {customer.segment_category}
                            </span>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-x-6 gap-y-2 mt-4">
                        <div className="flex items-center text-sm text-gray-600 font-medium"><Phone className="w-4 h-4 mr-2 text-gray-400" /> {customer.phone}</div>
                        {customer.email && <div className="flex items-center text-sm text-gray-600 font-medium"><Mail className="w-4 h-4 mr-2 text-gray-400" /> {customer.email}</div>}
                        {customer.address && <div className="flex items-center text-sm text-gray-600 font-medium"><MapPin className="w-4 h-4 mr-2 text-gray-400" /> {customer.address}</div>}
                    </div>
                </div>
                <div className="text-right shrink-0">
                    <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Lifetime Value</p>
                    <p className="text-4xl font-black text-blue-600">{formatBDT(Number(customer.total_spent))}</p>
                    {history && (
                        <p className="text-xs text-gray-400 font-bold mt-1">{history.total} transaction{history.total !== 1 ? 's' : ''}</p>
                    )}
                </div>
            </div>

            {/* Info Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <InfoCard label="Customer Group" value={customer.customerGroup?.name || '—'} icon={<FolderTree className="w-5 h-5 text-blue-600" />} />
                <InfoCard label="Territory" value={customer.territory?.name || '—'} icon={<Map className="w-5 h-5 text-emerald-600" />} />
                <InfoCard label="Credit Limit" value={customer.credit_limit ? `৳${Number(customer.credit_limit).toLocaleString()}` : '—'} icon={<CreditCard className="w-5 h-5 text-amber-600" />} />
                <InfoCard label="Default Discount" value={customer.default_discount_pct ? `${Number(customer.default_discount_pct)}%` : '—'} icon={<Building2 className="w-5 h-5 text-purple-600" />} />
            </div>

            {/* Credit Utilization */}
            {creditUtilization && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-3">Credit Utilization</p>
                    <div className="flex items-center space-x-4">
                        <div className="flex-1 bg-gray-100 rounded-full h-3 overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all ${Number(creditUtilization) > 80 ? 'bg-rose-500' : Number(creditUtilization) > 50 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                                style={{ width: `${Math.min(Number(creditUtilization), 100)}%` }}
                            />
                        </div>
                        <span className="font-black text-sm">{creditUtilization}%</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 font-medium">
                        ৳{Number(customer.total_spent).toLocaleString()} of ৳{Number(customer.credit_limit).toLocaleString()} used
                    </p>
                </div>
            )}

            {/* Purchase History */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-lg font-black flex items-center">
                        <ShoppingBag className="w-5 h-5 mr-2 text-blue-600" /> Purchase History
                    </h2>
                    {history && history.totalPages > 1 && (
                        <span className="text-xs text-gray-400 font-bold">
                            Page {history.page} of {history.totalPages}
                        </span>
                    )}
                </div>

                {historyLoading ? (
                    <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">Loading...</div>
                ) : !history || history.data.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">No transactions found.</div>
                ) : (
                    <>
                        <div className="divide-y divide-gray-50">
                            {history.data.map((sale: any) => (
                                <div key={sale.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                                    <div className="flex justify-between items-start mb-4">
                                        <div>
                                            <h3 className="font-black text-sm">{sale.serial_number}</h3>
                                            <p className="text-xs text-gray-500 font-medium">{new Date(sale.created_at).toLocaleString()}</p>
                                            {sale.payments && sale.payments.length > 0 && (
                                                <div className="flex gap-1 mt-1">
                                                    {sale.payments.map((p: any, i: number) => (
                                                        <span key={i} className="text-[9px] font-bold uppercase tracking-wider bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                                                            {p.payment_method}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-right">
                                            <p className="font-black">{formatBDT(Number(sale.amount_paid))}</p>
                                            <p className={`text-[10px] font-black uppercase tracking-widest ${sale.status === 'COMPLETED' ? 'text-emerald-500' : 'text-gray-400'}`}>{sale.status}</p>
                                        </div>
                                    </div>
                                    <div className="bg-gray-50 rounded-xl p-4 space-y-2">
                                        {sale.items?.map((item: any) => (
                                            <div key={item.id} className="flex justify-between text-sm">
                                                <span className="font-medium text-gray-700">{item.quantity}x {item.product?.name || 'Unknown Item'}</span>
                                                <span className="font-bold text-gray-900">{formatBDT(Number(item.price_at_sale) * item.quantity)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {history.totalPages > 1 && (
                            <div className="p-4 border-t border-gray-100 flex items-center justify-between">
                                <button
                                    onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}
                                    disabled={history.page === 1}
                                    className="flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-40"
                                >
                                    <ChevronLeft className="w-4 h-4" /> Previous
                                </button>
                                <span className="text-xs text-gray-400 font-bold">{history.total} total transactions</span>
                                <button
                                    onClick={() => setHistoryPage((p) => Math.min(history.totalPages, p + 1))}
                                    disabled={history.page === history.totalPages}
                                    className="flex items-center gap-1 text-sm font-bold text-gray-600 hover:text-gray-900 disabled:opacity-40"
                                >
                                    Next <ChevronRight className="w-4 h-4" />
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

function InfoCard({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
    return (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center space-x-4">
            <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center">{icon}</div>
            <div>
                <p className="text-gray-500 font-bold text-[10px] uppercase tracking-widest">{label}</p>
                <h3 className="text-lg font-black tracking-tight">{value}</h3>
            </div>
        </div>
    );
}

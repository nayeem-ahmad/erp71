'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '../../../../../lib/api';
import { formatBDT } from '../../../../../lib/format';
import {
    ArrowLeft, ShoppingBag, TrendingUp, Calendar, Clock, Package, BarChart3, Search,
} from 'lucide-react';

interface MonthlyTotal {
    month: string;
    orders: number;
    spent: number;
}

interface TopProduct {
    productId: string;
    name: string;
    quantity: number;
    totalValue: number;
    orderCount: number;
}

interface SaleItem {
    id: string;
    quantity: number;
    price_at_sale: string | number;
    product?: { name: string };
}

interface Transaction {
    id: string;
    serial_number: string;
    created_at: string;
    amount_paid: string | number;
    status: string;
    items: SaleItem[];
}

interface PurchaseHistory {
    customer: {
        id: string;
        name: string;
        customer_code: string;
        segment_category: string;
        total_spent: string | number;
    };
    summary: {
        totalOrders: number;
        totalSpent: number;
        avgOrderValue: number;
        firstPurchase: string | null;
        lastPurchase: string | null;
        purchaseFrequencyDays: number | null;
    };
    monthlyTotals: MonthlyTotal[];
    topProducts: TopProduct[];
    transactions: Transaction[];
}

const SEGMENT_COLORS: Record<string, string> = {
    VIP: 'bg-emerald-50 text-emerald-700',
    'At-Risk': 'bg-rose-50 text-rose-700',
    New: 'bg-blue-50 text-blue-700',
    Regular: 'bg-gray-100 text-gray-600',
};

export default function PurchaseHistoryPage() {
    const { id } = useParams();
    const router = useRouter();
    const [data, setData] = useState<PurchaseHistory | null>(null);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        if (id) {
            api.getCustomerHistory(id as string)
                .then(setData)
                .catch(console.error)
                .finally(() => setLoading(false));
        }
    }, [id]);

    if (loading) return <div className="p-8 font-black uppercase tracking-widest text-gray-400">Loading history...</div>;
    if (!data) return <div className="p-8 font-black text-rose-500 uppercase">History not available.</div>;

    const { customer, summary, monthlyTotals, topProducts, transactions } = data;
    const maxMonthlySpend = Math.max(...monthlyTotals.map(m => m.spent), 1);
    const filteredTransactions = transactions.filter(t =>
        t.serial_number?.toLowerCase().includes(search.toLowerCase()) ||
        t.items.some(i => i.product?.name?.toLowerCase().includes(search.toLowerCase()))
    );

    return (
        <div className="overflow-y-auto h-full p-8 bg-[#f9fafb] space-y-8">
            {/* Header */}
            <div className="flex items-center justify-between">
                <button
                    onClick={() => router.push(`/dashboard/customers/${id}`)}
                    className="flex items-center text-sm font-bold text-gray-500 hover:text-gray-900 transition-colors"
                >
                    <ArrowLeft className="w-4 h-4 mr-2" /> Back to Profile
                </button>
                <div className="flex items-center space-x-3">
                    <span className="font-mono text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                        {customer.customer_code}
                    </span>
                    <span className={`px-2.5 py-1 rounded-md text-[10px] font-black uppercase tracking-tighter ${SEGMENT_COLORS[customer.segment_category] ?? SEGMENT_COLORS.Regular}`}>
                        {customer.segment_category}
                    </span>
                </div>
            </div>

            <div>
                <h1 className="text-3xl font-black tracking-tight">{customer.name}</h1>
                <p className="text-sm text-gray-500 font-medium mt-1">Purchase History</p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
                <SummaryCard
                    label="Total Orders"
                    value={String(summary.totalOrders)}
                    icon={<ShoppingBag className="w-5 h-5 text-blue-600" />}
                    accent="blue"
                />
                <SummaryCard
                    label="Lifetime Spend"
                    value={`৳${summary.totalSpent.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`}
                    icon={<TrendingUp className="w-5 h-5 text-emerald-600" />}
                    accent="emerald"
                />
                <SummaryCard
                    label="Avg. Order Value"
                    value={`৳${summary.avgOrderValue.toLocaleString('en-BD', { minimumFractionDigits: 2 })}`}
                    icon={<BarChart3 className="w-5 h-5 text-amber-600" />}
                    accent="amber"
                />
                <SummaryCard
                    label="Purchase Frequency"
                    value={summary.purchaseFrequencyDays != null ? `every ${summary.purchaseFrequencyDays}d` : '—'}
                    icon={<Clock className="w-5 h-5 text-purple-600" />}
                    accent="purple"
                />
            </div>

            {summary.firstPurchase && summary.lastPurchase && (
                <div className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm flex items-center space-x-6">
                    <Calendar className="w-5 h-5 text-gray-400 flex-shrink-0" />
                    <div>
                        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Purchase Timeline</p>
                        <p className="text-sm font-bold text-gray-700 mt-0.5">
                            {new Date(summary.firstPurchase).toLocaleDateString('en-BD')} — {new Date(summary.lastPurchase).toLocaleDateString('en-BD')}
                        </p>
                    </div>
                </div>
            )}

            {/* Monthly Spending Chart */}
            {monthlyTotals.length > 0 && (
                <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-5">Monthly Spending</p>
                    <div className="space-y-3">
                        {monthlyTotals.slice(-12).map(month => (
                            <div key={month.month} className="flex items-center space-x-3">
                                <span className="text-xs font-mono text-gray-400 w-16 flex-shrink-0">{month.month}</span>
                                <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                                    <div
                                        className="h-full bg-blue-500 rounded-full"
                                        style={{ width: `${(month.spent / maxMonthlySpend) * 100}%` }}
                                    />
                                </div>
                                <div className="text-right flex-shrink-0 w-32">
                                    <span className="text-xs font-black text-gray-900">৳{month.spent.toFixed(0)}</span>
                                    <span className="text-[10px] text-gray-400 ml-1">({month.orders} orders)</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Top Products */}
            {topProducts.length > 0 && (
                <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
                    <p className="text-xs font-black uppercase tracking-widest text-gray-400 mb-4 flex items-center">
                        <Package className="w-4 h-4 mr-2" /> Top Purchased Products
                    </p>
                    <div className="space-y-3">
                        {topProducts.map((item, i) => (
                            <div key={item.productId} className="flex items-center justify-between">
                                <div className="flex items-center space-x-3">
                                    <span className="w-6 h-6 rounded-full bg-blue-50 text-blue-600 text-xs font-black flex items-center justify-center">
                                        {i + 1}
                                    </span>
                                    <span className="font-bold text-sm">{item.name}</span>
                                </div>
                                <div className="flex items-center space-x-4">
                                    <span className="text-xs text-gray-500 font-medium">{item.quantity} units</span>
                                    <span className="font-black text-sm">{formatBDT(item.totalValue)}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transaction List */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-lg font-black flex items-center">
                        <ShoppingBag className="w-5 h-5 mr-2 text-blue-600" /> All Transactions
                        <span className="ml-2 text-xs font-bold text-gray-400">({filteredTransactions.length})</span>
                    </h2>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search by reference or product..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 w-72"
                        />
                    </div>
                </div>
                <div className="divide-y divide-gray-50">
                    {filteredTransactions.length === 0 ? (
                        <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest text-xs">
                            No transactions found.
                        </div>
                    ) : (
                        filteredTransactions.map(sale => (
                            <div key={sale.id} className="p-6 hover:bg-gray-50/50 transition-colors">
                                <div className="flex justify-between items-start mb-3">
                                    <div>
                                        <h3 className="font-black text-sm">{sale.serial_number}</h3>
                                        <p className="text-xs text-gray-500 font-medium">
                                            {new Date(sale.created_at).toLocaleString('en-BD')}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <p className="font-black">{formatBDT(Number(sale.amount_paid))}</p>
                                        <span className={`text-[10px] font-black uppercase tracking-widest ${
                                            sale.status === 'COMPLETED' ? 'text-emerald-500' :
                                            sale.status === 'REFUNDED' ? 'text-rose-500' : 'text-gray-400'
                                        }`}>
                                            {sale.status}
                                        </span>
                                    </div>
                                </div>
                                <div className="bg-gray-50 rounded-xl p-3 space-y-1">
                                    {sale.items.map(item => (
                                        <div key={item.id} className="flex justify-between text-sm">
                                            <span className="font-medium text-gray-700">
                                                {item.quantity}× {item.product?.name ?? 'Unknown Item'}
                                            </span>
                                            <span className="font-bold text-gray-900">
                                                {formatBDT(Number(item.price_at_sale) * item.quantity)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}

function SummaryCard({ label, value, icon, accent }: {
    label: string;
    value: string;
    icon: React.ReactNode;
    accent: 'blue' | 'emerald' | 'amber' | 'purple';
}) {
    const bg: Record<string, string> = {
        blue: 'bg-blue-50',
        emerald: 'bg-emerald-50',
        amber: 'bg-amber-50',
        purple: 'bg-purple-50',
    };
    return (
        <div className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100">
            <div className={`w-10 h-10 ${bg[accent]} rounded-xl flex items-center justify-center mb-3`}>
                {icon}
            </div>
            <p className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">{label}</p>
            <p className="text-xl font-black tracking-tight">{value}</p>
        </div>
    );
}

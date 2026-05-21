import { useState } from 'react';
import { X, Search, AlertCircle } from 'lucide-react';
import { api } from '../../../lib/api';
import { formatBDT } from '../../../lib/format';

interface IssueReturnModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess: () => void;
}

export default function IssueReturnModal({ isOpen, onClose, onSuccess }: IssueReturnModalProps) {
    const [serialNumber, setSerialNumber] = useState('');
    const [sale, setSale] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [returnQuantities, setReturnQuantities] = useState<Record<string, number>>({});
    const [reason, setReason] = useState('');

    const reset = () => {
        setSerialNumber('');
        setSale(null);
        setError('');
        setReturnQuantities({});
        setReason('');
    };

    const handleClose = () => {
        reset();
        onClose();
    };

    if (!isOpen) return null;

    const searchReceipt = async () => {
        if (!serialNumber.trim()) return;
        setLoading(true);
        setError('');
        try {
            const allSales = await api.getSales();
            const found = allSales.find((s: any) => s.serial_number === serialNumber.trim());

            if (!found) {
                setError('Receipt not found');
                setSale(null);
                return;
            }

            // Fetch full sale detail to get per-item return history for accurate max-qty calculation
            const fullSale = await api.getSale(found.id);
            setSale(fullSale);

            const initial: Record<string, number> = {};
            fullSale.items.forEach((item: any) => {
                initial[item.id] = 0;
            });
            setReturnQuantities(initial);
        } catch {
            setError('Failed to fetch receipt');
        } finally {
            setLoading(false);
        }
    };

    // Calculate how many units of a sale item can still be returned
    const getMaxReturnQty = (item: any): number => {
        const alreadyReturned = (item.returns ?? []).reduce(
            (sum: number, r: any) => sum + (r.quantity ?? 0),
            0,
        );
        return Math.max(0, item.quantity - alreadyReturned);
    };

    const handleQuantityChange = (itemId: string, max: number, val: string) => {
        const num = parseInt(val) || 0;
        if (num < 0 || num > max) return;
        setReturnQuantities((prev) => ({ ...prev, [itemId]: num }));
    };

    const submitReturn = async () => {
        const itemsToReturn = Object.entries(returnQuantities)
            .filter(([, qty]) => qty > 0)
            .map(([id, qty]) => ({ saleItemId: id, quantity: qty }));

        if (itemsToReturn.length === 0) {
            setError('No items selected to return.');
            return;
        }

        setLoading(true);
        try {
            await api.createReturn({
                storeId: sale.store_id,
                saleId: sale.id,
                items: itemsToReturn,
                reason,
            });
            onSuccess();
            handleClose();
        } catch (err: any) {
            setError(err.message || 'Failed to process return');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                    <h2 className="text-xl font-black tracking-tight">Process Return</h2>
                    <button onClick={handleClose} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto w-full max-h-[80vh]">
                    {error && (
                        <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-bold flex items-center">
                            <AlertCircle className="w-4 h-4 mr-2" /> {error}
                        </div>
                    )}

                    {!sale ? (
                        <div className="space-y-4">
                            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">
                                Receipt Serial Number
                            </label>
                            <div className="flex space-x-2">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                    <input
                                        type="text"
                                        value={serialNumber}
                                        onChange={(e) => setSerialNumber(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && searchReceipt()}
                                        className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 pl-10 pr-4 font-black text-sm"
                                        placeholder="SL-12345678"
                                    />
                                </div>
                                <button
                                    onClick={searchReceipt}
                                    disabled={loading || !serialNumber.trim()}
                                    className="bg-gray-900 text-white px-6 rounded-xl font-bold uppercase text-xs tracking-widest shadow-xl disabled:opacity-50"
                                >
                                    {loading ? 'Searching...' : 'Search'}
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            <div className="bg-gray-50 p-4 rounded-2xl">
                                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Receipt Found</p>
                                <p className="font-black text-lg">{sale.serial_number}</p>
                                <p className="text-sm font-bold text-blue-600 mt-1">
                                    {formatBDT(Number(sale.total_amount))} Total
                                </p>
                            </div>

                            <div>
                                <h3 className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">
                                    Select Items to Return
                                </h3>
                                <div className="space-y-3">
                                    {sale.items.map((item: any) => {
                                        const maxQty = getMaxReturnQty(item);
                                        return (
                                            <div
                                                key={item.id}
                                                className={`flex flex-wrap items-center justify-between p-4 border rounded-xl gap-4 ${
                                                    maxQty === 0
                                                        ? 'border-gray-100 bg-gray-50 opacity-60'
                                                        : 'border-gray-100'
                                                }`}
                                            >
                                                <div className="flex-1 min-w-[150px]">
                                                    <p className="font-bold text-sm tracking-tight">
                                                        {item.product?.name || 'Item'}
                                                    </p>
                                                    <p className="text-xs font-black text-gray-400 uppercase tracking-widest">
                                                        {formatBDT(Number(item.price_at_sale))} / ea
                                                    </p>
                                                </div>
                                                <div className="flex items-center space-x-4">
                                                    <span className="text-xs font-bold text-gray-500 uppercase tracking-widest">
                                                        {maxQty === 0 ? 'Fully returned' : `Max: ${maxQty}`}
                                                    </span>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        max={maxQty}
                                                        disabled={maxQty === 0}
                                                        value={returnQuantities[item.id] || ''}
                                                        onChange={(e) =>
                                                            handleQuantityChange(item.id, maxQty, e.target.value)
                                                        }
                                                        className="w-20 bg-gray-50 border border-gray-200 rounded-lg p-2 text-center font-black focus:ring-2 focus:ring-blue-500/20 disabled:cursor-not-allowed"
                                                        placeholder="0"
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block">
                                    Reason for Return (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={reason}
                                    onChange={(e) => setReason(e.target.value)}
                                    className="w-full bg-gray-50 border border-gray-100 rounded-xl py-3 px-4 font-bold text-sm focus:ring-2 focus:ring-blue-500/20"
                                    placeholder="e.g. Defective, changed mind"
                                />
                            </div>

                            <button
                                onClick={submitReturn}
                                disabled={loading}
                                className="w-full bg-rose-600 text-white rounded-xl py-4 font-black uppercase tracking-widest shadow-xl shadow-rose-500/20 disabled:opacity-50 hover:bg-rose-700 hover:-translate-y-0.5 transition-all"
                            >
                                {loading ? 'Processing...' : 'Confirm Return'}
                            </button>
                            <button
                                onClick={() => setSale(null)}
                                disabled={loading}
                                className="w-full bg-white text-gray-400 uppercase tracking-widest text-xs font-bold py-2 mt-2 hover:text-gray-600 transition-colors"
                            >
                                Cancel / Try Another Receipt
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

import { AlertTriangle, CreditCard, Info, Package, XCircle } from 'lucide-react';

export function NotificationIcon({ type }: { type: string }) {
    if (type === 'LOW_STOCK') {
        return <Package className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />;
    }
    if (type === 'PAYMENT_FAILURE' || type === 'PAYMENT_RETRY_REMINDER') {
        return <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0 mt-0.5" />;
    }
    if (type === 'SUBSCRIPTION_CANCELLED') {
        return <XCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />;
    }
    if (
        type === 'SUBSCRIPTION_EXPIRY'
        || type === 'subscription_fee'
    ) {
        return <CreditCard className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />;
    }
    return <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />;
}
'use client';

import Link from 'next/link';
import { GitMerge, Pencil, ShoppingBasket, Trash2, Truck } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { routes } from '@/lib/routes';

type ProductRowActionsProps = {
    product: { id: string; name: string };
    canMerge: boolean;
    onEdit: () => void;
    onMerge: () => void;
    onDelete: () => void;
};

export default function ProductRowActions({
    product,
    canMerge,
    onEdit,
    onMerge,
    onDelete,
}: ProductRowActionsProps) {
    const { t } = useI18n();

    return (
        <div className="flex items-center justify-end space-x-1 rtl:space-x-reverse">
            <button
                onClick={onEdit}
                className="p-1.5 rounded-lg text-primary hover:bg-primary-light transition-colors"
                title={t.inventory.actions.editProduct}
            >
                <Pencil className="w-4 h-4" />
            </button>
            <Link
                href={`${routes.purchases.newPurchase}?productId=${product.id}&from=products`}
                className="p-1.5 rounded-lg text-emerald-600 hover:bg-emerald-50 transition-colors"
                title={t.inventory.actions.addStock}
            >
                <ShoppingBasket className="w-4 h-4" />
            </Link>
            <Link
                href={`/inventory/transfers?productId=${product.id}`}
                className="p-1.5 rounded-lg text-blue-600 hover:bg-blue-50 transition-colors"
                title={t.inventory.actions.transferHistory}
            >
                <Truck className="w-4 h-4" />
            </Link>
            {canMerge && (
                <button
                    type="button"
                    onClick={onMerge}
                    className="p-1.5 rounded-lg text-indigo-600 hover:bg-indigo-50 transition-colors"
                    title={t.inventory.actions.mergeInto}
                >
                    <GitMerge className="w-4 h-4" />
                </button>
            )}
            <button
                onClick={onDelete}
                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 transition-colors"
                title={t.inventory.actions.delete}
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}

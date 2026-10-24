'use client';

import { GitMerge, Pencil, ShoppingBasket, Trash2, Truck } from 'lucide-react';
import { RowActions, RowActionButton } from '@/components/table';
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
        <RowActions>
            <RowActionButton icon={<Pencil />} label={t.inventory.actions.editProduct} onClick={onEdit} />
            <RowActionButton
                icon={<ShoppingBasket />}
                label={t.inventory.actions.addStock}
                intent="success"
                href={`${routes.purchases.newPurchase}?productId=${product.id}&from=products`}
            />
            <RowActionButton
                icon={<Truck />}
                label={t.inventory.actions.transferHistory}
                href={`/inventory/transfers?productId=${product.id}`}
            />
            {canMerge && (
                <RowActionButton icon={<GitMerge />} label={t.inventory.actions.mergeInto} onClick={onMerge} />
            )}
            <RowActionButton icon={<Trash2 />} label={t.inventory.actions.delete} intent="danger" onClick={onDelete} />
        </RowActions>
    );
}

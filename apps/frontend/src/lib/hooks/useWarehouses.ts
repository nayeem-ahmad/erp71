'use client';

import { useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { getWorkspaceItem } from '@/lib/session-store';

export interface WarehouseOption {
    id: string;
    name: string;
    code: string;
    store_id: string;
    is_default: boolean;
    is_active: boolean;
}

/**
 * Which of the tenant's configured defaults an entry screen should open on.
 * Mirrors `TRANSACTION_DEFAULT_FIELD` in the backend's `inventory.utils`; the
 * returns have no default of their own there, and pass nothing.
 */
const SETTINGS_DEFAULT_FIELD = {
    sale: 'default_sales_warehouse_id',
    purchase: 'default_purchase_warehouse_id',
} as const;

export type WarehouseDefaultFor = keyof typeof SETTINGS_DEFAULT_FIELD;

/**
 * The warehouses an entry screen may post stock to, for the branch this tab is
 * looking at.
 *
 * Filtered to the active store because that is the rule the backend enforces: a
 * document's warehouse must belong to its own store, or stock would move
 * between branches without a transfer. Inactive warehouses are dropped for the
 * same reason — they are not valid destinations.
 *
 * `multiple` is what the screens key their UI off. A shop with one warehouse
 * should never be shown a picker with one option, so every caller hides the
 * control until there is a genuine choice to make; the backend keeps resolving
 * the default in that case exactly as it always did.
 *
 * `defaultWarehouseId` is the warehouse the **server** would pick — the
 * tenant's configured default for this kind of document, then the branch's own
 * default. Resolving it here rather than leaving the picker blank is what makes
 * the control honest: a screen that opened on "Default" would not tell anyone
 * where their stock was actually going.
 *
 * A failure is not surfaced: the picker simply does not appear and the entry
 * posts to the configured default, as it did before any of this existed.
 * Warehouse selection refines a flow that works without it, so it must never be
 * able to stop an entry screen from loading.
 */
export function useWarehouses(defaultFor?: WarehouseDefaultFor) {
    const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
    const [settingsDefaultId, setSettingsDefaultId] = useState('');
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        const storeId = getWorkspaceItem('store_id') || '';

        (async () => {
            try {
                const [rows, settings] = await Promise.all([
                    api.getInventoryWarehouses(),
                    defaultFor ? api.getInventorySettings() : Promise.resolve(null),
                ]);
                if (cancelled) return;

                setWarehouses(
                    (Array.isArray(rows) ? rows : [])
                        .filter((warehouse: WarehouseOption) =>
                            warehouse.is_active && (!storeId || warehouse.store_id === storeId))
                        .sort((left: WarehouseOption, right: WarehouseOption) =>
                            Number(right.is_default) - Number(left.is_default)
                            || left.name.localeCompare(right.name)),
                );
                setSettingsDefaultId(
                    (defaultFor && settings?.[SETTINGS_DEFAULT_FIELD[defaultFor]]) || '',
                );
            } catch (error) {
                console.error('Failed to load warehouses', error);
                if (!cancelled) {
                    setWarehouses([]);
                    setSettingsDefaultId('');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [defaultFor]);

    // Only if it survived the store/active filter above: a configured default
    // pointing at a closed warehouse is one the server would reject anyway.
    const configured = warehouses.find((warehouse) => warehouse.id === settingsDefaultId);

    return {
        warehouses,
        loading,
        /** True once there is a real choice, which is what turns the pickers on. */
        multiple: warehouses.length > 1,
        defaultWarehouseId: configured?.id
            ?? warehouses.find((warehouse) => warehouse.is_default)?.id
            ?? warehouses[0]?.id
            ?? '',
    };
}

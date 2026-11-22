import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchScopeService } from '../database/branch-scope.service';
import { DatabaseService } from '../database/database.service';
import { TenantContext } from '../database/tenant.decorator';

/** How many name matches come back when the code is not an exact SKU. */
const NAME_MATCH_LIMIT = 8;

export interface PriceCheckBranch {
    storeId: string;
    storeName: string;
    quantity: number;
    warehouses: Array<{ warehouseId: string; name: string; quantity: number }>;
}

export interface PriceCheckProduct {
    id: string;
    name: string;
    sku: string | null;
    price: number;
    compareAtPrice: number | null;
    unitType: string;
    imageUrl: string | null;
    brand: string | null;
    group: string | null;
    /** On hand across the branches this member may see. */
    totalQuantity: number;
    /** This member's own branch first, then the rest by name. */
    branches: PriceCheckBranch[];
}

/**
 * Tools → Price checker: scan a barcode (or type a name) and see what a
 * product sells for and where it is in stock — the question a customer asks
 * on the shop floor. Never the cost: this is for anyone who may see the
 * catalogue, cashiers included.
 */
@Injectable()
export class PriceCheckService {
    constructor(
        private readonly db: DatabaseService,
        private readonly branchScope: BranchScopeService,
    ) {}

    async lookup(ctx: TenantContext, rawCode: string): Promise<{ exact: boolean; products: PriceCheckProduct[] }> {
        const code = (rawCode ?? '').trim().slice(0, 100);
        if (!code) return { exact: false, products: [] };

        const visibleStoreIds = (await this.branchScope.canSeeAllBranches(ctx))
            ? null
            : await this.branchScope.memberStoreIds(ctx);

        const select = {
            id: true,
            name: true,
            sku: true,
            price: true,
            compare_at_price: true,
            unit_type: true,
            image_url: true,
            brand: { select: { name: true } },
            group: { select: { name: true } },
            stocks: {
                where: visibleStoreIds ? { warehouse: { store_id: { in: visibleStoreIds } } } : {},
                select: {
                    quantity: true,
                    warehouse: {
                        select: { id: true, name: true, is_active: true, store: { select: { id: true, name: true } } },
                    },
                },
            },
        } satisfies Prisma.ProductSelect;

        // A scanner types the SKU exactly; a person may type part of a name.
        const exact = await this.db.product.findMany({
            where: { tenant_id: ctx.tenantId, deleted_at: null, sku: { equals: code, mode: 'insensitive' } },
            select,
            take: 3,
        });

        const rows = exact.length
            ? exact
            : await this.db.product.findMany({
                  where: {
                      tenant_id: ctx.tenantId,
                      deleted_at: null,
                      AND: code
                          .split(/\s+/)
                          .filter(Boolean)
                          .slice(0, 5)
                          .map((term) => ({
                              OR: [
                                  { name: { contains: term, mode: 'insensitive' as const } },
                                  { sku: { contains: term, mode: 'insensitive' as const } },
                              ],
                          })),
                  },
                  select,
                  orderBy: { name: 'asc' },
                  take: NAME_MATCH_LIMIT,
              });

        return { exact: exact.length > 0, products: rows.map((row) => this.shape(row, ctx.storeId)) };
    }

    private shape(
        row: {
            id: string;
            name: string;
            sku: string | null;
            price: Prisma.Decimal;
            compare_at_price: Prisma.Decimal | null;
            unit_type: string;
            image_url: string | null;
            brand: { name: string } | null;
            group: { name: string } | null;
            stocks: Array<{
                quantity: number;
                warehouse: { id: string; name: string; is_active: boolean; store: { id: string; name: string } };
            }>;
        },
        homeStoreId: string | undefined,
    ): PriceCheckProduct {
        const byStore = new Map<string, PriceCheckBranch>();
        for (const stock of row.stocks) {
            if (!stock.warehouse.is_active && stock.quantity === 0) continue;
            const store = stock.warehouse.store;
            const branch = byStore.get(store.id) ?? { storeId: store.id, storeName: store.name, quantity: 0, warehouses: [] };
            branch.quantity += stock.quantity;
            branch.warehouses.push({ warehouseId: stock.warehouse.id, name: stock.warehouse.name, quantity: stock.quantity });
            byStore.set(store.id, branch);
        }
        const branches = [...byStore.values()].sort((a, b) => {
            if (a.storeId === homeStoreId) return -1;
            if (b.storeId === homeStoreId) return 1;
            return a.storeName.localeCompare(b.storeName);
        });
        return {
            id: row.id,
            name: row.name,
            sku: row.sku,
            price: Number(row.price),
            compareAtPrice: row.compare_at_price === null ? null : Number(row.compare_at_price),
            unitType: row.unit_type,
            imageUrl: row.image_url,
            brand: row.brand?.name ?? null,
            group: row.group?.name ?? null,
            totalQuantity: branches.reduce((sum, branch) => sum + branch.quantity, 0),
            branches,
        };
    }
}

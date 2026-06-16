import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PriceListDiscountType } from '@prisma/client';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { resolvePrice } from './price-list-resolver';
import {
    BulkUpdatePriceListItemsDto,
    CreatePriceListDto,
    UpdatePriceListDto,
    UpdatePriceListItemDto,
} from './price-lists.dto';

@Injectable()
export class PriceListsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreatePriceListDto) {
        const existing = await this.db.priceList.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });
        if (existing) {
            throw new BadRequestException('A price list with this name already exists.');
        }

        if (dto.overall_discount_type === 'PERCENTAGE' && (dto.overall_discount_value ?? 0) > 100) {
            throw new BadRequestException('Overall percentage discount cannot exceed 100%.');
        }

        return this.db.$transaction(async (tx) => {
            if (dto.is_default) {
                await tx.priceList.updateMany({
                    where: { tenant_id: tenantId, is_default: true },
                    data: { is_default: false },
                });
            }

            const priceList = await tx.priceList.create({
                data: {
                    tenant_id: tenantId,
                    name: dto.name,
                    description: dto.description ?? null,
                    is_default: dto.is_default ?? false,
                    overall_discount_type: dto.overall_discount_type ?? null,
                    overall_discount_value: dto.overall_discount_value ?? null,
                },
            });

            await this.syncProductsToList(tx, tenantId, priceList.id);
            return priceList;
        });
    }

    async findAll(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.priceList.findMany({
                    ...(args as object),
                    include: {
                        _count: { select: { items: true, customerGroups: true } },
                    },
                }),
            count: (args) => this.db.priceList.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: [{ is_default: 'desc' }, { name: 'asc' }],
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const list = await this.db.priceList.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                _count: { select: { items: true, customerGroups: true } },
            },
        });
        if (!list) throw new NotFoundException('Price list not found');
        return list;
    }

    async update(tenantId: string, id: string, dto: UpdatePriceListDto) {
        await this.findOne(tenantId, id);

        if (dto.name) {
            const duplicate = await this.db.priceList.findFirst({
                where: { tenant_id: tenantId, name: dto.name, NOT: { id } },
            });
            if (duplicate) {
                throw new BadRequestException('A price list with this name already exists.');
            }
        }

        if (dto.overall_discount_type === 'PERCENTAGE' && (dto.overall_discount_value ?? 0) > 100) {
            throw new BadRequestException('Overall percentage discount cannot exceed 100%.');
        }

        return this.db.$transaction(async (tx) => {
            if (dto.is_default) {
                await tx.priceList.updateMany({
                    where: { tenant_id: tenantId, is_default: true, NOT: { id } },
                    data: { is_default: false },
                });
            }

            return tx.priceList.update({
                where: { id },
                data: {
                    ...(dto.name !== undefined ? { name: dto.name } : {}),
                    ...(dto.description !== undefined ? { description: dto.description } : {}),
                    ...(dto.is_default !== undefined ? { is_default: dto.is_default } : {}),
                    ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
                    ...(dto.overall_discount_type !== undefined
                        ? { overall_discount_type: dto.overall_discount_type }
                        : {}),
                    ...(dto.overall_discount_value !== undefined
                        ? { overall_discount_value: dto.overall_discount_value }
                        : {}),
                },
                include: {
                    _count: { select: { items: true, customerGroups: true } },
                },
            });
        });
    }

    async remove(tenantId: string, id: string) {
        const list = await this.findOne(tenantId, id);
        if ((list as any)._count.customerGroups > 0) {
            throw new BadRequestException(
                'Cannot delete this price list — it is assigned to customer groups. Reassign them first.',
            );
        }
        if (list.is_default) {
            throw new BadRequestException('Cannot delete the default price list. Set another list as default first.');
        }
        return this.db.priceList.delete({ where: { id } });
    }

    async listItems(tenantId: string, priceListId: string, page = 1, limit = 50, search?: string) {
        await this.findOne(tenantId, priceListId);
        const list = await this.db.priceList.findUnique({ where: { id: priceListId } });
        if (!list) throw new NotFoundException('Price list not found');

        const where: any = {
            price_list_id: priceListId,
            product: {
                tenant_id: tenantId,
                deleted_at: null,
                ...(search
                    ? {
                          OR: [
                              { name: { contains: search, mode: 'insensitive' } },
                              { sku: { contains: search, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
        };

        return paginatedFindMany({
            findMany: (args) =>
                this.db.priceListItem.findMany({
                    ...(args as object),
                    include: {
                        product: {
                            select: {
                                id: true,
                                name: true,
                                sku: true,
                                price: true,
                                image_url: true,
                            },
                        },
                    },
                }),
            count: (args) => this.db.priceListItem.count(args as any),
            where,
            orderBy: { product: { name: 'asc' } },
            page,
            limit,
        }).then((result) => ({
            ...result,
            items: result.items.map((row: any) => this.mapItemRow(row, list)),
        }));
    }

    async updateItem(
        tenantId: string,
        priceListId: string,
        productId: string,
        dto: UpdatePriceListItemDto,
    ) {
        await this.findOne(tenantId, priceListId);
        this.validateItemDiscount(dto);

        const product = await this.db.product.findFirst({
            where: { id: productId, tenant_id: tenantId, deleted_at: null },
        });
        if (!product) throw new NotFoundException('Product not found');

        const list = await this.db.priceList.findUnique({ where: { id: priceListId } });
        if (!list) throw new NotFoundException('Price list not found');

        const item = await this.db.priceListItem.upsert({
            where: { price_list_id_product_id: { price_list_id: priceListId, product_id: productId } },
            create: {
                price_list_id: priceListId,
                product_id: productId,
                selling_price: dto.selling_price ?? null,
                discount_type: dto.discount_type ?? null,
                discount_value: dto.discount_value ?? null,
            },
            update: {
                ...(dto.selling_price !== undefined ? { selling_price: dto.selling_price } : {}),
                ...(dto.discount_type !== undefined ? { discount_type: dto.discount_type } : {}),
                ...(dto.discount_value !== undefined ? { discount_value: dto.discount_value } : {}),
            },
            include: {
                product: {
                    select: { id: true, name: true, sku: true, price: true, image_url: true },
                },
            },
        });

        return this.mapItemRow(item, list);
    }

    async bulkUpdateItems(tenantId: string, priceListId: string, dto: BulkUpdatePriceListItemsDto) {
        await this.findOne(tenantId, priceListId);
        this.validateItemDiscount(dto);

        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenantId,
                deleted_at: null,
                id: { in: dto.product_ids },
            },
            select: { id: true },
        });

        if (products.length !== dto.product_ids.length) {
            throw new BadRequestException('One or more products not found.');
        }

        await this.db.$transaction(
            dto.product_ids.map((productId) =>
                this.db.priceListItem.upsert({
                    where: {
                        price_list_id_product_id: { price_list_id: priceListId, product_id: productId },
                    },
                    create: {
                        price_list_id: priceListId,
                        product_id: productId,
                        selling_price: dto.selling_price ?? null,
                        discount_type: dto.discount_type ?? null,
                        discount_value: dto.discount_value ?? null,
                    },
                    update: {
                        ...(dto.selling_price !== undefined ? { selling_price: dto.selling_price } : {}),
                        ...(dto.discount_type !== undefined ? { discount_type: dto.discount_type } : {}),
                        ...(dto.discount_value !== undefined ? { discount_value: dto.discount_value } : {}),
                    },
                }),
            ),
        );

        return { updated: dto.product_ids.length };
    }

    async syncProducts(tenantId: string, priceListId: string) {
        await this.findOne(tenantId, priceListId);
        const added = await this.db.$transaction(async (tx) =>
            this.syncProductsToList(tx, tenantId, priceListId),
        );
        return { added };
    }

    async resolvePriceListForCustomer(tenantId: string, customerGroupId?: string | null) {
        if (customerGroupId) {
            const group = await this.db.customerGroup.findFirst({
                where: { id: customerGroupId, tenant_id: tenantId },
                include: { priceList: true },
            });
            if (group?.priceList?.is_active) {
                return group.priceList;
            }
        }

        return this.db.priceList.findFirst({
            where: { tenant_id: tenantId, is_default: true, is_active: true },
        });
    }

    async getResolvedPricesForProducts(
        tenantId: string,
        productIds: string[],
        priceListId?: string | null,
    ): Promise<Map<string, { sellingPrice: number; compareAtPrice: number | null }>> {
        const products = await this.db.product.findMany({
            where: { tenant_id: tenantId, deleted_at: null, id: { in: productIds } },
            select: { id: true, price: true },
        });

        let list = priceListId
            ? await this.db.priceList.findFirst({
                  where: { id: priceListId, tenant_id: tenantId, is_active: true },
              })
            : await this.db.priceList.findFirst({
                  where: { tenant_id: tenantId, is_default: true, is_active: true },
              });

        const items = list
            ? await this.db.priceListItem.findMany({
                  where: { price_list_id: list.id, product_id: { in: productIds } },
              })
            : [];

        const itemsByProductId = new Map(items.map((item) => [item.product_id, item]));
        const result = new Map<string, { sellingPrice: number; compareAtPrice: number | null }>();

        for (const product of products) {
            const item = itemsByProductId.get(product.id);
            const normalizedItem = item
                ? {
                      selling_price: item.selling_price != null ? Number(item.selling_price) : null,
                      discount_type: item.discount_type,
                      discount_value: item.discount_value != null ? Number(item.discount_value) : null,
                  }
                : undefined;
            const normalizedList = list
                ? {
                      overall_discount_type: list.overall_discount_type,
                      overall_discount_value:
                          list.overall_discount_value != null
                              ? Number(list.overall_discount_value)
                              : null,
                  }
                : undefined;
            const resolved = resolvePrice(Number(product.price), normalizedItem, normalizedList);
            result.set(product.id, resolved);
        }

        return result;
    }

    async addProductToAllActiveLists(tenantId: string, productId: string) {
        const lists = await this.db.priceList.findMany({
            where: { tenant_id: tenantId, is_active: true },
            select: { id: true },
        });

        if (lists.length === 0) return;

        await this.db.priceListItem.createMany({
            data: lists.map((list) => ({
                price_list_id: list.id,
                product_id: productId,
            })),
            skipDuplicates: true,
        });
    }

    async ensureDefaultPriceList(tenantId: string) {
        const existing = await this.db.priceList.findFirst({
            where: { tenant_id: tenantId, is_default: true },
        });
        if (existing) return existing;

        const list = await this.db.priceList.create({
            data: {
                tenant_id: tenantId,
                name: 'Standard Retail',
                description: 'Default catalog prices',
                is_default: true,
            },
        });

        await this.syncProductsToList(this.db, tenantId, list.id);
        return list;
    }

    async validatePriceListBelongsToTenant(tenantId: string, priceListId: string) {
        const list = await this.db.priceList.findFirst({
            where: { id: priceListId, tenant_id: tenantId },
        });
        if (!list) throw new BadRequestException('Price list not found for this tenant.');
        return list;
    }

    private mapItemRow(row: any, list: { overall_discount_type: PriceListDiscountType | null; overall_discount_value: any }) {
        const basePrice = Number(row.product.price);
        const resolved = resolvePrice(basePrice, row, list);

        return {
            id: row.id,
            product_id: row.product_id,
            selling_price: row.selling_price != null ? Number(row.selling_price) : null,
            discount_type: row.discount_type,
            discount_value: row.discount_value != null ? Number(row.discount_value) : null,
            base_price: basePrice,
            final_price: resolved.sellingPrice,
            compare_at_price: resolved.compareAtPrice,
            product: row.product,
        };
    }

    private validateItemDiscount(dto: {
        selling_price?: number | null;
        discount_type?: PriceListDiscountType | null;
        discount_value?: number | null;
    }) {
        if (dto.selling_price != null && dto.discount_type != null) {
            throw new BadRequestException('Set either selling price or discount, not both.');
        }

        if (dto.discount_type === 'PERCENTAGE' && (dto.discount_value ?? 0) > 100) {
            throw new BadRequestException('Percentage discount cannot exceed 100%.');
        }
    }

    private async syncProductsToList(tx: any, tenantId: string, priceListId: string): Promise<number> {
        const products = await tx.product.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            select: { id: true },
        });

        if (products.length === 0) return 0;

        const result = await tx.priceListItem.createMany({
            data: products.map((p: { id: string }) => ({
                price_list_id: priceListId,
                product_id: p.id,
            })),
            skipDuplicates: true,
        });

        return result.count;
    }
}
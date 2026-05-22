import {
    Injectable,
    NotFoundException,
    BadRequestException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { PlaceOrderDto } from './storefront.dto';
import { paginate } from '../common/pagination.dto';

@Injectable()
export class StorefrontService {
    constructor(private db: DatabaseService) {}

    async getStorefront(slug: string) {
        const tenant = await this.db.tenant.findFirst({
            where: {
                storefront_slug: slug,
                storefront_enabled: true,
            },
            select: {
                id: true,
                name: true,
                storefront_banner: true,
            },
        });

        if (!tenant) {
            throw new NotFoundException('Storefront not found or not available');
        }

        const products = await this.db.product.findMany({
            where: {
                tenant_id: tenant.id,
                deleted_at: null,
                stocks: {
                    some: {
                        quantity: { gt: 0 },
                    },
                },
            },
            select: {
                id: true,
                name: true,
                price: true,
                image_url: true,
                stocks: {
                    select: {
                        quantity: true,
                    },
                },
            },
            orderBy: { name: 'asc' },
        });

        // Aggregate stock quantity across all warehouses
        const productsWithStock = products.map((p) => ({
            id: p.id,
            name: p.name,
            selling_price: p.price,
            image_url: p.image_url,
            stock_quantity: p.stocks.reduce((sum, s) => sum + s.quantity, 0),
        }));

        return {
            tenant: {
                name: tenant.name,
                storefront_banner: tenant.storefront_banner,
            },
            products: productsWithStock,
        };
    }

    async placeOrder(slug: string, dto: PlaceOrderDto) {
        const tenant = await this.db.tenant.findFirst({
            where: {
                storefront_slug: slug,
                storefront_enabled: true,
            },
            select: { id: true },
        });

        if (!tenant) {
            throw new NotFoundException('Storefront not found or not available');
        }

        const productIds = dto.items.map((i) => i.productId);

        const products = await this.db.product.findMany({
            where: {
                id: { in: productIds },
                tenant_id: tenant.id,
                deleted_at: null,
            },
            select: {
                id: true,
                price: true,
                name: true,
                stocks: {
                    select: { quantity: true },
                },
            },
        });

        if (products.length !== productIds.length) {
            throw new BadRequestException('One or more products not found for this store');
        }

        const productMap = new Map(products.map((p) => [p.id, p]));

        // Validate stock for all items
        for (const item of dto.items) {
            const product = productMap.get(item.productId)!;
            const totalStock = product.stocks.reduce((sum, s) => sum + s.quantity, 0);
            if (totalStock < item.quantity) {
                throw new BadRequestException(
                    `Insufficient stock for product "${product.name}" (available: ${totalStock})`,
                );
            }
        }

        // Calculate total
        let totalAmount = 0;
        for (const item of dto.items) {
            const product = productMap.get(item.productId)!;
            totalAmount += Number(product.price) * item.quantity;
        }

        const order = await this.db.$transaction(async (tx) => {
            return tx.storefrontOrder.create({
                data: {
                    tenantId: tenant.id,
                    customerName: dto.customerName,
                    customerEmail: dto.customerEmail,
                    customerPhone: dto.customerPhone ?? null,
                    notes: dto.notes ?? null,
                    totalAmount,
                    status: 'PENDING',
                    items: {
                        create: dto.items.map((item) => ({
                            productId: item.productId,
                            quantity: item.quantity,
                            priceAtOrder: Number(productMap.get(item.productId)!.price),
                        })),
                    },
                },
                include: {
                    items: {
                        include: {
                            product: {
                                select: { id: true, name: true },
                            },
                        },
                    },
                },
            });
        });

        return order;
    }

    async getOrders(tenantId: string, page: number, limit: number) {
        const skip = (page - 1) * limit;
        const [items, total] = await Promise.all([
            this.db.storefrontOrder.findMany({
                where: { tenantId },
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, name: true } },
                        },
                    },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.storefrontOrder.count({ where: { tenantId } }),
        ]);

        return paginate(items, total, page, limit);
    }

    async updateOrderStatus(tenantId: string, orderId: string, status: string) {
        const validStatuses = ['PENDING', 'CONFIRMED', 'CANCELLED'];
        if (!validStatuses.includes(status)) {
            throw new BadRequestException(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
        }

        const order = await this.db.storefrontOrder.findFirst({
            where: { id: orderId, tenantId },
        });

        if (!order) {
            throw new NotFoundException('Order not found');
        }

        return this.db.storefrontOrder.update({
            where: { id: orderId },
            data: { status },
        });
    }
}

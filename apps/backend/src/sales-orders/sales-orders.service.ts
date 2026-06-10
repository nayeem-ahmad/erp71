import { Injectable, BadRequestException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSalesOrderDto, UpdateSalesOrderDto, UpdateOrderStatusDto, AddDepositDto } from './sales-orders.dto';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';

@Injectable()
export class SalesOrdersService {
    constructor(private db: DatabaseService) {}

    private normalizeDeliveryDate(value?: Date | string) {
        if (!value) return undefined;

        const parsed = new Date(
            typeof value === 'string' && value.length === 10
                ? `${value}T00:00:00.000Z`
                : value,
        );

        if (Number.isNaN(parsed.getTime())) {
            throw new BadRequestException('Invalid delivery date');
        }

        return parsed;
    }

    async create(tenantId: string, userId: string, dto: CreateSalesOrderDto) {
        return this.db.$transaction(async (tx) => {
            const orderNumber = `ORD-${Date.now()}`;
            const deliveryDate = this.normalizeDeliveryDate(dto.deliveryDate);
            
            const itemsData = dto.items.map(item => ({
                product_id: item.productId,
                quantity: item.quantity,
                price_at_order: item.priceAtOrder
            }));

            const order = await tx.salesOrder.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    customer_id: dto.customerId,
                    order_number: orderNumber,
                    total_amount: dto.totalAmount,
                    status: dto.status || 'DRAFT',
                    payment_status: 'UNPAID',
                    delivery_date: deliveryDate,
                    created_by: userId,
                    items: { create: itemsData }
                },
                include: { items: true }
            });

            return order;
        });
    }

    async updateStatus(tenantId: string, id: string, dto: UpdateOrderStatusDto) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id, tenant_id: tenantId },
                include: { items: true }
            });

            if (!order) throw new BadRequestException('Order not found');

            // If transitioning to DELIVERED, decrement stock
            if (dto.status === 'DELIVERED' && order.status !== 'DELIVERED') {
                const warehouseId = await resolveWarehouseId(tx, tenantId, order.store_id);
                for (const item of order.items) {
                    await applyInventoryMovement(tx, {
                        tenantId,
                        productId: item.product_id,
                        warehouseId,
                        quantityDelta: -item.quantity,
                        movementType: 'SALES_ORDER_DELIVERY',
                        referenceType: 'SALES_ORDER',
                        referenceId: id,
                    });
                }
                
                // Also update customer total_spent based on the entire order amount
                if (order.customer_id) {
                     await tx.customer.update({
                         where: { id: order.customer_id },
                         data: { total_spent: { increment: order.total_amount } }
                     });
                }
            }

            return tx.salesOrder.update({
                where: { id },
                data: { status: dto.status }
            });
        });
    }

    async addDeposit(tenantId: string, id: string, dto: AddDepositDto) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id, tenant_id: tenantId },
                include: { deposits: true }
            });

            if (!order) throw new BadRequestException('Order not found');

            const currentPaid = Number(order.amount_paid);
            const newPaid = currentPaid + dto.amount;

            // Recalculate payment status
            let paymentStatus = order.payment_status;
            if (newPaid >= Number(order.total_amount)) {
                paymentStatus = 'PAID';
            } else if (newPaid > 0) {
                paymentStatus = 'PARTIAL';
            }

            await tx.orderDeposit.create({
                data: {
                    order_id: id,
                    amount: dto.amount,
                    payment_method: dto.paymentMethod
                }
            });

            return tx.salesOrder.update({
                where: { id },
                data: { 
                    amount_paid: newPaid,
                    payment_status: paymentStatus 
                },
                include: { deposits: true }
            });
        });
    }

    async findAll(tenantId: string) {
        return this.db.salesOrder.findMany({
            where: { tenant_id: tenantId },
            include: { customer: true, items: { include: { product: true } }, deposits: true },
            orderBy: { created_at: 'desc' }
        });
    }

    async findOne(tenantId: string, id: string) {
        return this.db.salesOrder.findFirst({
            where: { id, tenant_id: tenantId },
            include: { customer: true, items: { include: { product: true } }, deposits: true }
        });
    }

    async update(tenantId: string, id: string, dto: UpdateSalesOrderDto) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.salesOrder.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true },
            });
            if (!existing) throw new BadRequestException('Order not found');
            if (existing.status === 'DELIVERED') {
                throw new BadRequestException('Cannot edit a delivered order');
            }

            const updateData: any = {};
            if (dto.customerId !== undefined) updateData.customer_id = dto.customerId || null;
            if (dto.status !== undefined) updateData.status = dto.status;
            if (dto.deliveryDate !== undefined) {
                updateData.delivery_date = this.normalizeDeliveryDate(dto.deliveryDate);
            }

            if (dto.items && dto.items.length > 0) {
                // Delete old items and create new ones
                await tx.salesOrderItem.deleteMany({ where: { order_id: id } });

                const totalAmount = dto.totalAmount ?? dto.items.reduce(
                    (sum, item) => sum + item.quantity * item.priceAtOrder, 0,
                );
                updateData.total_amount = totalAmount;

                return tx.salesOrder.update({
                    where: { id },
                    data: {
                        ...updateData,
                        items: {
                            create: dto.items.map((item) => ({
                                product_id: item.productId,
                                quantity: item.quantity,
                                price_at_order: item.priceAtOrder,
                            })),
                        },
                    },
                    include: { customer: true, items: { include: { product: true } }, deposits: true },
                });
            }

            if (dto.totalAmount !== undefined) updateData.total_amount = dto.totalAmount;

            return tx.salesOrder.update({
                where: { id },
                data: updateData,
                include: { customer: true, items: { include: { product: true } }, deposits: true },
            });
        });
    }

    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const order = await tx.salesOrder.findFirst({
                where: { id, tenant_id: tenantId },
            });
            if (!order) throw new BadRequestException('Order not found');
            if (order.status === 'DELIVERED') {
                throw new BadRequestException('Cannot delete a delivered order');
            }

            await tx.orderDeposit.deleteMany({ where: { order_id: id } });
            await tx.salesOrderItem.deleteMany({ where: { order_id: id } });
            await tx.salesOrder.deleteMany({ where: { id, tenant_id: tenantId } });

            return { deleted: true };
        });
    }
}

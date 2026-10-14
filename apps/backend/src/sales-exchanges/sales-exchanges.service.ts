import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { splitTaxInclusive } from '@erp71/shared-types';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, resolveEntryWarehouses, usableWarehouseIds } from '../database/inventory.utils';
import { resolveProductCosts } from '../database/product-cost.utils';
import { autoPostFromRules, voidAutoPostedVoucher, type AutoPostResult } from '../accounting/posting.utils';
import { loadPostingSummaries, loadPostingSummary, NO_POSTING_EVENT } from '../accounting/posting-status.util';
import { assertCustomerCreditForSale } from '../customers/customer-credit.utils';
import { findOpenSessionForUser } from '../cashier-sessions/active-session.util';
import { completedExchangeLinesInclude, committedReturnQuantity } from '../sales/open-sale-quantity';
import { CreateSalesExchangeDto } from './sales-exchanges.dto';
import {
    isZeroMoney,
    legsFromStoredSettlement,
    roundMoney,
    settleExchange,
    type ExchangeSettlement,
} from './exchange-settlement';

const SALE_ITEM_INCLUDE = {
    returns: true,
    exchangeLines: completedExchangeLinesInclude,
} as const;

@Injectable()
export class SalesExchangesService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, userId: string, dto: CreateSalesExchangeDto) {
        if (!dto.lines?.length) {
            throw new BadRequestException('An exchange needs at least one line.');
        }

        return this.db.$transaction(async (tx) => {
            const sale = await tx.sale.findFirst({
                where: { id: dto.saleId, tenant_id: tenantId },
                include: {
                    items: { include: SALE_ITEM_INCLUDE },
                    payments: { orderBy: { created_at: 'asc' } },
                },
            });
            if (!sale) throw new NotFoundException('Sale not found');
            if (sale.status === 'DRAFT' || sale.status === 'CANCELLED') {
                throw new BadRequestException('A draft or cancelled sale cannot be exchanged.');
            }

            const tenant = await tx.tenant.findUnique({
                where: { id: tenantId },
                select: { default_vat_rate: true },
            });
            const defaultVatRate = Number(tenant?.default_vat_rate ?? 0) || 0;

            const replacementIds = [...new Set(dto.lines.map((line) => line.replacementProductId))];
            const products = await tx.product.findMany({
                where: { id: { in: replacementIds }, tenant_id: tenantId, deleted_at: null },
                select: { id: true, vat_rate: true, sd_rate: true },
            });
            const productById = new Map(products.map((product) => [product.id, product]));

            const costs = await resolveProductCosts(tx, {
                tenantId,
                storeId: sale.store_id,
                productIds: replacementIds,
            });

            const inheritable = await usableWarehouseIds(tx, tenantId, sale.store_id, [
                sale.warehouse_id,
                ...sale.items.map((item) => item.warehouse_id),
            ]);
            const inherited = (warehouseId?: string | null) =>
                warehouseId && inheritable.has(warehouseId) ? warehouseId : null;
            const warehouses = await resolveEntryWarehouses(
                tx,
                tenantId,
                sale.store_id,
                inherited(sale.warehouse_id) ?? undefined,
                [],
            );

            const claimed = new Map<string, number>();
            const lineData = [];
            let returnedTotal = 0;
            let replacementTotal = 0;

            for (const line of dto.lines) {
                if (!Number.isInteger(line.quantity) || line.quantity < 1) {
                    throw new BadRequestException('Returned quantity must be a whole number of at least 1.');
                }
                if (!Number.isInteger(line.replacementQuantity) || line.replacementQuantity < 1) {
                    throw new BadRequestException('Replacement quantity must be a whole number of at least 1.');
                }
                if (line.unitPrice < 0) {
                    throw new BadRequestException('Replacement price cannot be negative.');
                }
                const unitPrice = roundMoney(line.unitPrice);

                const saleItem = sale.items.find((item) => item.id === line.saleItemId);
                if (!saleItem) {
                    throw new BadRequestException(`Item ${line.saleItemId} is not on this sale.`);
                }
                const product = productById.get(line.replacementProductId);
                if (!product) {
                    throw new BadRequestException(`Product ${line.replacementProductId} not found.`);
                }

                const already = claimed.get(saleItem.id) ?? 0;
                const open = saleItem.quantity - committedReturnQuantity(saleItem) - already;
                if (line.quantity > open) {
                    throw new BadRequestException(
                        `Cannot exchange ${line.quantity}. Only ${Math.max(0, open)} still open on this line.`,
                    );
                }
                claimed.set(saleItem.id, already + line.quantity);

                const returnedAmount = roundMoney(Number(saleItem.price_at_sale) * line.quantity);
                const replacementAmount = roundMoney(unitPrice * line.replacementQuantity);
                returnedTotal = roundMoney(returnedTotal + returnedAmount);
                replacementTotal = roundMoney(replacementTotal + replacementAmount);

                const returnedTax = splitTaxInclusive(returnedAmount, {
                    vatRate: saleItem.vat_rate != null ? Number(saleItem.vat_rate) : 0,
                    sdRate: saleItem.sd_rate != null ? Number(saleItem.sd_rate) : 0,
                });
                const replacementVat = product.vat_rate != null ? Number(product.vat_rate) : defaultVatRate;
                const replacementSd = product.sd_rate != null ? Number(product.sd_rate) : 0;
                const replacementTax = splitTaxInclusive(replacementAmount, {
                    vatRate: replacementVat,
                    sdRate: replacementSd,
                });

                const warehouseId = inherited(saleItem.warehouse_id) ?? warehouses.entryWarehouseId;
                lineData.push({
                    sale_item_id: saleItem.id,
                    returned_product_id: saleItem.product_id,
                    returned_quantity: line.quantity,
                    returned_unit_price: Number(saleItem.price_at_sale),
                    returned_unit_cost: saleItem.unit_cost_at_sale ?? null,
                    returned_vat_rate: saleItem.vat_rate,
                    returned_sd_rate: saleItem.sd_rate,
                    returned_vat_amount: returnedTax.vatAmount,
                    returned_sd_amount: returnedTax.sdAmount,
                    replacement_product_id: product.id,
                    replacement_quantity: line.replacementQuantity,
                    replacement_unit_price: unitPrice,
                    replacement_unit_cost: costs.get(product.id) ?? null,
                    replacement_vat_rate: replacementVat,
                    replacement_sd_rate: replacementSd,
                    replacement_vat_amount: replacementTax.vatAmount,
                    replacement_sd_amount: replacementTax.sdAmount,
                    warehouse_id: warehouseId,
                });
            }

            const settlement = settleExchange({
                returnedTotal,
                replacementTotal,
                saleTotal: Number(sale.total_amount),
                amountPaid: Number(sale.amount_paid),
                firstPaymentMethod: sale.payments[0]?.payment_method ?? null,
            });

            if (!isZeroMoney(settlement.dueDelta) && !sale.customer_id) {
                throw new BadRequestException('This invoice has no customer, so the difference cannot change a due.');
            }

            if (settlement.dueDelta > 0) {
                const customer = await tx.customer.findFirst({
                    where: { id: sale.customer_id!, tenant_id: tenantId, deleted_at: null },
                    select: { due_balance: true, credit_limit: true, store_id: true },
                });
                if (!customer) throw new NotFoundException('Customer not found');
                assertCustomerCreditForSale(
                    {
                        due_balance: Number(customer.due_balance),
                        credit_limit: customer.credit_limit != null ? Number(customer.credit_limit) : null,
                    },
                    settlement.dueDelta,
                );
            }

            const session = await findOpenSessionForUser(tx, tenantId, userId);
            const exchangeNumber = `EXC-${Date.now()}`;
            const exchange = await tx.salesExchange.create({
                data: {
                    tenant_id: tenantId,
                    store_id: sale.store_id,
                    sale_id: sale.id,
                    session_id: session?.id ?? null,
                    exchange_number: exchangeNumber,
                    reason: dto.reason,
                    status: 'COMPLETED',
                    returned_total: returnedTotal,
                    replacement_total: replacementTotal,
                    difference: settlement.difference,
                    settlement_mode: settlement.settlementMode,
                    due_delta: settlement.dueDelta,
                    cash_delta: settlement.cashDelta,
                    warehouse_id: warehouses.entryWarehouseId,
                    created_by: userId,
                    items: { create: lineData },
                },
                include: { items: true },
            });

            for (const item of lineData) {
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.returned_product_id,
                    warehouseId: item.warehouse_id,
                    quantityDelta: item.returned_quantity,
                    movementType: 'EXCHANGE_IN',
                    referenceType: 'SALES_EXCHANGE',
                    referenceId: exchange.id,
                });
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.replacement_product_id,
                    warehouseId: item.warehouse_id,
                    quantityDelta: -item.replacement_quantity,
                    movementType: 'EXCHANGE_OUT',
                    referenceType: 'SALES_EXCHANGE',
                    referenceId: exchange.id,
                });
            }

            await this.applyCustomer(tx, tenantId, userId, sale.customer_id, settlement, exchange.id, exchangeNumber, 1);

            const vouchers = await this.postLegs(tx, tenantId, sale, exchange.id, exchangeNumber, settlement);
            const postingStatus = vouchers.length === 0
                ? 'skipped'
                : vouchers.every((voucher) => voucher.postingStatus === 'skipped')
                    ? 'skipped'
                    : 'posted';

            return {
                ...exchange,
                posting_status: postingStatus,
                vouchers,
            };
        });
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string; storeId?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const result = await paginatedFindMany({
            findMany: (args) =>
                this.db.salesExchange.findMany({
                    ...(args as object),
                    include: {
                        sale: { select: { id: true, serial_number: true, reference_number: true, customer: { select: { id: true, name: true } } } },
                        items: true,
                    },
                }),
            count: (args) => this.db.salesExchange.count(args as any),
            where: {
                tenant_id: tenantId,
                ...(opts?.storeId ? { store_id: opts.storeId } : {}),
                ...(created ? { created_at: created } : {}),
            },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });
        const summaries = await loadPostingSummaries(
            this.db,
            tenantId,
            'sales',
            'sale_exchange',
            result.items.map((row: { id: string }) => row.id),
        );
        return {
            ...result,
            items: result.items.map((row: { id: string }) => ({ ...row, ...(summaries.get(row.id) ?? NO_POSTING_EVENT) })),
        };
    }

    async findOne(tenantId: string, id: string) {
        const exchange = await this.db.salesExchange.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                sale: {
                    select: {
                        id: true,
                        serial_number: true,
                        reference_number: true,
                        customer: { select: { id: true, name: true, phone: true } },
                    },
                },
                items: {
                    include: {
                        returnedProduct: { select: { id: true, name: true, sku: true } },
                        replacementProduct: { select: { id: true, name: true, sku: true } },
                    },
                },
                store: { select: { id: true, name: true } },
            },
        });
        if (!exchange) throw new NotFoundException('Exchange not found');
        const posting = await loadPostingSummary(this.db, tenantId, 'sales', 'sale_exchange', exchange.id);
        return { ...exchange, ...posting };
    }

    async cancel(tenantId: string, userId: string, id: string, note: string) {
        const trimmed = note?.trim() ?? '';
        if (trimmed.length < 5) {
            throw new BadRequestException('A cancellation note is required and must say why the entry is being cancelled.');
        }

        return this.db.$transaction(async (tx) => {
            const exchange = await tx.salesExchange.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, sale: { select: { id: true, customer_id: true, serial_number: true, store_id: true } } },
            });
            if (!exchange) throw new NotFoundException('Exchange not found');
            if (exchange.status === 'CANCELLED') {
                throw new BadRequestException('This exchange is already cancelled.');
            }

            const settlement: ExchangeSettlement = {
                difference: Number(exchange.difference),
                settlementMode: exchange.settlement_mode as ExchangeSettlement['settlementMode'],
                dueDelta: Number(exchange.due_delta),
                cashDelta: Number(exchange.cash_delta),
                tenderDelta: roundMoney(Number(exchange.difference) - Number(exchange.due_delta)),
                legs: legsFromStoredSettlement({
                    difference: Number(exchange.difference),
                    dueDelta: Number(exchange.due_delta),
                    settlementMode: exchange.settlement_mode as ExchangeSettlement['settlementMode'],
                }),
            };

            for (const item of exchange.items) {
                const warehouseId = item.warehouse_id ?? exchange.warehouse_id;
                if (!warehouseId) {
                    throw new BadRequestException('This exchange has no warehouse to reverse stock through.');
                }
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.returned_product_id,
                    warehouseId,
                    quantityDelta: -item.returned_quantity,
                    movementType: 'EXCHANGE_IN_REVERSAL',
                    referenceType: 'SALES_EXCHANGE',
                    referenceId: exchange.id,
                });
                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.replacement_product_id,
                    warehouseId,
                    quantityDelta: item.replacement_quantity,
                    movementType: 'EXCHANGE_OUT_REVERSAL',
                    referenceType: 'SALES_EXCHANGE',
                    referenceId: exchange.id,
                });
            }

            await this.applyCustomer(
                tx,
                tenantId,
                userId,
                exchange.sale.customer_id,
                settlement,
                exchange.id,
                exchange.exchange_number,
                -1,
            );

            for (const leg of settlement.legs) {
                await voidAutoPostedVoucher(tx, tenantId, leg.eventType, exchange.id, leg.legKey);
            }

            const updated = await tx.salesExchange.update({
                where: { id: exchange.id },
                data: {
                    status: 'CANCELLED',
                    cancelled_at: new Date(),
                    cancelled_by: userId,
                    cancellation_note: trimmed,
                },
            });
            return updated;
        });
    }

    private async applyCustomer(
        tx: any,
        tenantId: string,
        userId: string,
        customerId: string | null,
        settlement: ExchangeSettlement,
        exchangeId: string,
        exchangeNumber: string,
        direction: 1 | -1,
    ) {
        if (!customerId) return;

        const spend = roundMoney(settlement.difference * direction);
        if (!isZeroMoney(spend)) {
            await tx.customer.update({
                where: { id: customerId },
                data: { total_spent: { increment: spend } },
            });
        }

        const due = roundMoney(settlement.dueDelta * direction);
        if (isZeroMoney(due)) return;

        const customer = await tx.customer.findUnique({
            where: { id: customerId },
            select: { due_balance: true, store_id: true },
        });
        const balanceAfter = roundMoney(Number(customer?.due_balance ?? 0) + due);
        await tx.customerCreditTransaction.create({
            data: {
                tenant_id: tenantId,
                customer_id: customerId,
                store_id: customer?.store_id,
                type: 'ADJUSTMENT',
                amount: due,
                balance_after: balanceAfter,
                reference_type: 'SALES_EXCHANGE',
                reference_id: exchangeId,
                notes: direction === 1
                    ? `Exchange ${exchangeNumber}`
                    : `Cancel exchange ${exchangeNumber}`,
                created_by: userId,
            },
        });
        await tx.customer.update({
            where: { id: customerId },
            data: { due_balance: balanceAfter },
        });
    }

    private async postLegs(
        tx: any,
        tenantId: string,
        sale: { customer_id: string | null; serial_number: string; store_id: string },
        exchangeId: string,
        exchangeNumber: string,
        settlement: ExchangeSettlement,
    ): Promise<AutoPostResult[]> {
        const results: AutoPostResult[] = [];
        for (const leg of settlement.legs) {
            results.push(await autoPostFromRules({
                tx,
                tenantId,
                eventType: leg.eventType,
                conditionKey: 'payment_mode',
                conditionValue: leg.mode,
                sourceModule: 'sales',
                sourceType: 'sale_exchange',
                sourceId: exchangeId,
                amount: leg.amount,
                description: `Exchange ${exchangeNumber} against ${sale.serial_number}`,
                referenceNumber: exchangeNumber,
                storeId: sale.store_id,
                partyType: sale.customer_id ? 'CUSTOMER' : undefined,
                partyId: sale.customer_id ?? undefined,
                legKey: leg.legKey,
            }));
        }
        return results;
    }
}

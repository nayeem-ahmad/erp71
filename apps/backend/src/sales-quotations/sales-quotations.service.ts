import { randomBytes } from 'node:crypto';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateQuotationDto, UpdateQuotationDto, UpdateQuotationStatusDto } from './sales-quotations.dto';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { toPublicQuotation } from './public-quotation.dto';

@Injectable()
export class SalesQuotationsService {
    constructor(
        private db: DatabaseService,
        private ordersService: SalesOrdersService,
        private readonly shortLinks: ShortLinksService
    ) {}

    async create(tenantId: string, dto: CreateQuotationDto) {
        return this.db.$transaction(async (tx) => {
            const quoteNumber = `QT-${Date.now()}`;
            
            const itemsData = dto.items.map(item => ({
                product_id: item.productId,
                quantity: item.quantity,
                unit_price: item.unitPrice
            }));

            return tx.quotation.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    customer_id: dto.customerId,
                    quote_number: quoteNumber,
                    total_amount: dto.totalAmount,
                    valid_until: dto.validUntil ? new Date(dto.validUntil) : null,
                    notes: dto.notes,
                    items: { create: itemsData }
                },
                include: { items: true }
            });
        });
    }

    async revise(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const oldQuote = await tx.quotation.findUnique({
                where: { id, tenant_id: tenantId },
                include: { items: true }
            });

            if (!oldQuote) throw new BadRequestException('Quotation not found');
            if (oldQuote.status !== 'DRAFT' && oldQuote.status !== 'SENT') {
                throw new BadRequestException('Cannot revise a quotation that is already processed.');
            }

            // Mark old as REVISED
            await tx.quotation.update({
                where: { id },
                data: { status: 'REVISED' }
            });

            // Create new version
            const newVersion = oldQuote.version + 1;
            const originalQuoteId = oldQuote.original_quote_id || oldQuote.id;

            const itemsData = oldQuote.items.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price
            }));

            return tx.quotation.create({
                data: {
                    tenant_id: tenantId,
                    store_id: oldQuote.store_id,
                    customer_id: oldQuote.customer_id,
                    quote_number: oldQuote.quote_number,
                    total_amount: oldQuote.total_amount,
                    valid_until: oldQuote.valid_until,
                    notes: oldQuote.notes,
                    version: newVersion,
                    original_quote_id: originalQuoteId,
                    items: { create: itemsData }
                },
                include: { items: true }
            });
        });
    }

    async convertToOrder(tenantId: string, userId: string, id: string) {
        const quote = await this.db.quotation.findUnique({
             where: { id, tenant_id: tenantId },
             include: { items: true }
        });

        if (!quote) throw new BadRequestException('Quote not found');
        if (quote.status === 'CONVERTED') throw new BadRequestException('Already converted');

        // Call the SalesOrdersService natively
        const newOrder = await this.ordersService.create(tenantId, userId, {
            storeId: quote.store_id,
            customerId: quote.customer_id || undefined,
            totalAmount: Number(quote.total_amount),
            items: quote.items.map(item => ({
                productId: item.product_id,
                quantity: item.quantity,
                priceAtOrder: Number(item.unit_price)
            }))
        });

        // Mark quote as converted
        await this.db.quotation.update({
             where: { id },
             data: { status: 'CONVERTED' }
        });

        return newOrder;
    }

    async update(tenantId: string, id: string, dto: UpdateQuotationDto) {
        return this.db.$transaction(async (tx) => {
            const existing = await tx.quotation.findFirst({
                where: { id, tenant_id: tenantId },
                include: { items: true, customer: true },
            });

            if (!existing) {
                throw new BadRequestException('Quotation not found');
            }

            if (existing.status === 'CONVERTED' || existing.status === 'REVISED') {
                throw new BadRequestException('Cannot edit this quotation');
            }

            const updateData: Record<string, unknown> = {};

            if (dto.customerId !== undefined) {
                updateData.customer_id = dto.customerId || null;
            }

            if (dto.notes !== undefined) {
                updateData.notes = dto.notes || null;
            }

            if (dto.validUntil !== undefined) {
                updateData.valid_until = dto.validUntil ? new Date(dto.validUntil) : null;
            }

            if (dto.items && dto.items.length > 0) {
                const totalAmount = dto.totalAmount ?? dto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);

                await tx.quotationItem.deleteMany({ where: { quotation_id: id } });

                return tx.quotation.update({
                    where: { id },
                    data: {
                        ...updateData,
                        total_amount: totalAmount,
                        items: {
                            create: dto.items.map((item) => ({
                                product_id: item.productId,
                                quantity: item.quantity,
                                unit_price: item.unitPrice,
                            })),
                        },
                    },
                    include: { customer: true, items: { include: { product: true } } },
                });
            }

            if (dto.totalAmount !== undefined) {
                updateData.total_amount = dto.totalAmount;
            }

            return tx.quotation.update({
                where: { id },
                data: updateData,
                include: { customer: true, items: { include: { product: true } } },
            });
        });
    }

    async updateStatus(tenantId: string, id: string, dto: UpdateQuotationStatusDto) {
        return this.db.quotation.update({
            where: { id, tenant_id: tenantId },
            data: { status: dto.status }
        });
    }

    async findAll(tenantId: string, page = 1, limit = 20): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.quotation.findMany({
                    ...(args as object),
                    include: { customer: true, items: { include: { product: true } } },
                }),
            count: (args) => this.db.quotation.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        return this.db.quotation.findFirst({
            where: { id, tenant_id: tenantId },
            include: { customer: true, items: { include: { product: true } } }
        });
    }

    async remove(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const quote = await tx.quotation.findFirst({
                where: { id, tenant_id: tenantId },
            });

            if (!quote) {
                throw new BadRequestException('Quotation not found');
            }

            if (quote.status === 'CONVERTED') {
                throw new BadRequestException('Cannot delete a converted quotation');
            }

            await tx.quotationItem.deleteMany({ where: { quotation_id: id } });
            await tx.quotation.deleteMany({ where: { id, tenant_id: tenantId } });

            return { deleted: true };
        });
    }

    /**
     * Mints (or reuses) the public link for a quotation.
     *
     * The token is the authority and the short code is only an alias, so this is
     * safe to call repeatedly: a second call returns the same link rather than
     * leaving another live URL behind every time someone opens the share modal.
     */
    async share(tenantId: string, userId: string, id: string) {
        const quote = await this.db.quotation.findFirst({ where: { id, tenant_id: tenantId } });
        if (!quote) throw new NotFoundException('Quotation not found');

        let token = quote.share_token;
        if (!token) {
            token = randomBytes(16).toString('base64url'); // ~22 chars, URL-safe
            await this.db.quotation.update({
                where: { id },
                data: { share_token: token, share_token_at: new Date() },
            });
        }

        const link = await this.shortLinks.createForEntity({
            tenantId,
            userId,
            entityType: 'QUOTATION',
            entityId: id,
            targetUrl: `/q/${token}`,
        });

        return { code: link.code, path: `/s/${link.code}` };
    }

    /**
     * Clearing the token is the whole revocation. Every link ever sent for this
     * quotation resolves through it, so short and long URLs die together.
     */
    async revokeShare(tenantId: string, id: string) {
        const result = await this.db.quotation.updateMany({
            where: { id, tenant_id: tenantId },
            data: { share_token: null, share_token_at: null },
        });
        if (result.count === 0) throw new NotFoundException('Quotation not found');
        return { success: true };
    }

    /** Public read by token. No tenant context — the token is the authorization. */
    async findByShareToken(token: string) {
        // select, not include, on every relation: Product carries reorder_level,
        // safety_stock and lead_time_days, and Customer carries contact details,
        // neither of which a public quotation page should ever pull into memory.
        const quote = await this.db.quotation.findFirst({
            where: { share_token: token },
            select: {
                quote_number: true,
                version: true,
                status: true,
                created_at: true,
                valid_until: true,
                notes: true,
                total_amount: true,
                customer: { select: { name: true } },
                store: { select: { name: true } },
                items: {
                    select: {
                        quantity: true,
                        unit_price: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });
        if (!quote) throw new NotFoundException('This link is no longer available');
        return toPublicQuotation(quote);
    }
}

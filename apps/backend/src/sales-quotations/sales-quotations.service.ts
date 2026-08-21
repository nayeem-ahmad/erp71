import { randomBytes } from 'node:crypto';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import {
    CreateQuotationDto,
    ProformaTermsDto,
    UpdateQuotationDto,
    UpdateQuotationStatusDto,
    QuotationDocKind,
} from './sales-quotations.dto';
import { DocumentSeries, nextDocumentNumber } from '../database/document-number.utils';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { ShortLinksService } from '../short-links/short-links.service';
import { toPublicQuotation } from './public-quotation.dto';

/**
 * Both share entity types resolve to a Quotation row and to the same
 * `/q/<token>` page; they exist apart so link analytics can tell a proforma
 * open from a quote open. Every lookup that finds "the live link for this
 * quotation" therefore has to match both, because a document's kind — and so
 * the type its link was minted under — can change after the link exists.
 */
const SHARE_ENTITY_TYPES = ['QUOTATION', 'PROFORMA_INVOICE'] as const;

const shareEntityTypeFor = (docKind: string) =>
    docKind === 'PROFORMA' ? ('PROFORMA_INVOICE' as const) : ('QUOTATION' as const);

@Injectable()
export class SalesQuotationsService {
    constructor(
        private db: DatabaseService,
        private ordersService: SalesOrdersService,
        private readonly shortLinks: ShortLinksService
    ) {}

    /**
     * Maps the commercial-terms half of a create/update DTO onto column names,
     * and enforces the one rule that cannot live in a decorator: a non-BDT
     * document needs a rate, because `convertToOrder` has to translate it and a
     * missing rate there would silently carry a foreign amount into a BDT
     * ledger.
     *
     * Only keys the caller actually sent are returned, so a PATCH that touches
     * the notes cannot blank the incoterm.
     */
    private termsToColumns(dto: ProformaTermsDto, current?: { currency: string; exchange_rate: unknown }) {
        const data: Record<string, unknown> = {};

        if (dto.docKind !== undefined) data.doc_kind = dto.docKind;
        if (dto.currency !== undefined) data.currency = dto.currency.toUpperCase();
        if (dto.exchangeRate !== undefined) data.exchange_rate = dto.exchangeRate;
        if (dto.incoterm !== undefined) data.incoterm = dto.incoterm || null;
        if (dto.portOfLoading !== undefined) data.port_of_loading = dto.portOfLoading || null;
        if (dto.portOfDischarge !== undefined) data.port_of_discharge = dto.portOfDischarge || null;
        if (dto.paymentTerms !== undefined) data.payment_terms = dto.paymentTerms || null;
        if (dto.advancePercent !== undefined) data.advance_percent = dto.advancePercent;
        if (dto.deliveryLeadTimeDays !== undefined) data.delivery_lead_time_days = dto.deliveryLeadTimeDays;
        if (dto.countryOfOrigin !== undefined) data.country_of_origin = dto.countryOfOrigin || null;

        // Resolve against what the row will hold after this write, not against
        // what the DTO happens to mention: setting currency alone on a row that
        // already has a rate is fine, and so is setting a rate alone.
        const currency = (data.currency as string) ?? current?.currency ?? 'BDT';
        const rate = data.exchange_rate ?? (current ? Number(current.exchange_rate ?? 0) || null : null);

        if (currency !== 'BDT' && !rate) {
            throw new BadRequestException('An exchange rate is required for a document not denominated in BDT.');
        }

        // A BDT document has no rate to hold. Storing 1 would look like a real
        // FX rate to every reader, including convertToOrder.
        if (currency === 'BDT' && data.currency !== undefined) {
            data.exchange_rate = null;
        }

        return data;
    }

    async create(tenantId: string, dto: CreateQuotationDto) {
        const terms = this.termsToColumns(dto);
        const docKind: QuotationDocKind = dto.docKind ?? 'QUOTE';

        return this.db.$transaction(async (tx) => {
            const quoteNumber = await nextDocumentNumber(tx, {
                tenantId,
                series: docKind === 'PROFORMA' ? DocumentSeries.PROFORMA : DocumentSeries.QUOTE,
            });

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
                    ...terms,
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

            // Mark old as REVISED and clear its share token so the token can
            // move to the new row without violating the @unique constraint.
            await tx.quotation.update({
                where: { id },
                data: { status: 'REVISED', share_token: null, share_token_at: null }
            });

            // Create new version
            const newVersion = oldQuote.version + 1;
            const originalQuoteId = oldQuote.original_quote_id || oldQuote.id;

            const itemsData = oldQuote.items.map(item => ({
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: item.unit_price
            }));

            const newQuote = await tx.quotation.create({
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
                    share_token: oldQuote.share_token,
                    share_token_at: oldQuote.share_token_at,
                    // Carried forward wholesale. A revision restates the same
                    // commercial offer at new numbers — dropping the incoterm or
                    // the payment terms here would silently turn revision 2 of a
                    // proforma into a bare quote.
                    doc_kind: oldQuote.doc_kind,
                    currency: oldQuote.currency,
                    exchange_rate: oldQuote.exchange_rate,
                    incoterm: oldQuote.incoterm,
                    port_of_loading: oldQuote.port_of_loading,
                    port_of_discharge: oldQuote.port_of_discharge,
                    payment_terms: oldQuote.payment_terms,
                    advance_percent: oldQuote.advance_percent,
                    delivery_lead_time_days: oldQuote.delivery_lead_time_days,
                    country_of_origin: oldQuote.country_of_origin,
                    items: { create: itemsData }
                },
                include: { items: true }
            });

            // Re-point any live short link at the new quotation id so
            // re-sharing finds it instead of minting a redundant code.
            await tx.shortLink.updateMany({
                where: {
                    tenant_id: tenantId,
                    entity_type: { in: [...SHARE_ENTITY_TYPES] },
                    entity_id: id,
                    revoked_at: null,
                },
                data: { entity_id: newQuote.id },
            });

            return newQuote;
        });
    }

    /**
     * Turns an accepted quotation or proforma into a sales order.
     *
     * **The rate is fixed here, not at the order.** `SalesOrder` has no currency
     * column and the ledger behind it is BDT-only, so a foreign-currency
     * proforma is translated on the way through at the rate written on the
     * document. Reading a live rate at conversion instead would mean the order
     * total no longer matched the PI the customer signed, which is the one
     * number they will check.
     *
     * The returned `suggested_advance` is what `advance_percent` comes to in
     * BDT — the deposit the counter should ask for. It is a suggestion, not a
     * charge: `OrderDeposit` is written when money actually arrives.
     */
    async convertToOrder(tenantId: string, userId: string, id: string) {
        const quote = await this.db.quotation.findUnique({
             where: { id, tenant_id: tenantId },
             include: { items: true }
        });

        if (!quote) throw new BadRequestException('Quote not found');
        if (quote.status === 'CONVERTED') throw new BadRequestException('Already converted');

        // A missing currency reads as BDT, not as an error: the column is
        // defaulted and NOT NULL, so the only way to see one absent is a
        // narrowed select or a fixture, and neither should block a conversion.
        const rate = !quote.currency || quote.currency === 'BDT' ? 1 : Number(quote.exchange_rate ?? 0);
        if (!rate) {
            // Only reachable on a row written before the rate was mandatory, or
            // by a direct database edit. Failing here beats booking a USD figure
            // into a BDT order and discovering it in the month-end reconciliation.
            throw new BadRequestException(
                `This document is in ${quote.currency} but carries no exchange rate, so it cannot be converted.`,
            );
        }

        const toBdt = (amount: unknown) => Number(amount ?? 0) * rate;

        // Call the SalesOrdersService natively
        const newOrder = await this.ordersService.create(tenantId, userId, {
            storeId: quote.store_id,
            customerId: quote.customer_id || undefined,
            totalAmount: toBdt(quote.total_amount),
            items: quote.items.map(item => ({
                productId: item.product_id,
                quantity: item.quantity,
                priceAtOrder: toBdt(item.unit_price)
            }))
        });

        // Mark quote as converted
        await this.db.quotation.update({
             where: { id },
             data: { status: 'CONVERTED' }
        });

        const advancePercent = Number(quote.advance_percent ?? 0);

        return {
            ...newOrder,
            source_doc_kind: quote.doc_kind,
            source_currency: quote.currency,
            exchange_rate_applied: rate,
            // `x * pct` rounded then divided by 100 lands on paisa in one step;
            // dividing first and rounding after would drop the same fraction
            // twice on a percentage like 33.33.
            suggested_advance: advancePercent > 0
                ? Math.round(toBdt(quote.total_amount) * advancePercent) / 100
                : 0,
        };
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

            if (dto.docKind === 'QUOTE' && existing.doc_kind === 'PROFORMA') {
                // Demotion is refused rather than silently allowed: a proforma
                // may already have an advance receipted against it, and its
                // number has been issued out of the PI series and printed.
                // Promotion the other way is fine and keeps the original number.
                throw new BadRequestException('A proforma invoice cannot be turned back into a quotation.');
            }

            const updateData: Record<string, unknown> = {
                ...this.termsToColumns(dto, existing),
            };

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

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string; docKind?: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo);
        return paginatedFindMany({
            findMany: (args) =>
                this.db.quotation.findMany({
                    ...(args as object),
                    include: { customer: true, items: { include: { product: true } } },
                }),
            count: (args) => this.db.quotation.count(args as any),
            where: {
                tenant_id: tenantId,
                ...(created ? { created_at: created } : {}),
                // Absent means both kinds, which is what an unfiltered list has
                // always shown. The two are only ever separated on request.
                ...(opts?.docKind ? { doc_kind: opts.docKind } : {}),
            },
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
            entityType: shareEntityTypeFor(quote.doc_kind),
            entityId: id,
            targetUrl: `/q/${token}`,
        });

        return { code: link.code, path: `/s/${link.code}` };
    }

    /**
     * Revokes the public link for a quotation.
     *
     * Clearing the token kills the destination — every URL ever sent resolves
     * through it — but the ShortLink row has to die with it. Left alive, `/s/<code>`
     * keeps resolving and counting clicks onto a page that no longer exists, the
     * tenant's own shortener list still shows the link as active with a Revoke
     * button next to it (contradicting the revocation the user just performed),
     * and re-sharing mints a fresh token and therefore a fresh code, leaving the
     * orphan behind for good.
     *
     * Both writes go in one transaction: a half-applied revocation — token gone,
     * code still live and counting — is exactly the state this method exists to
     * prevent.
     */
    async revokeShare(tenantId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const result = await tx.quotation.updateMany({
                where: { id, tenant_id: tenantId },
                data: { share_token: null, share_token_at: null },
            });
            if (result.count === 0) throw new NotFoundException('Quotation not found');

            await tx.shortLink.updateMany({
                where: {
                    tenant_id: tenantId,
                    entity_type: { in: [...SHARE_ENTITY_TYPES] },
                    entity_id: id,
                    revoked_at: null,
                },
                data: { revoked_at: new Date() },
            });

            return { success: true };
        });
    }

    /** Public read by token. No tenant context — the token is the authorization. */
    async findByShareToken(token: string) {
        // select, not include, on every relation: Product carries reorder_level,
        // safety_stock and lead_time_days, and Customer carries contact details,
        // neither of which a public quotation page should ever pull into memory.
        const quote = await this.db.quotation.findFirst({
            where: { share_token: token },
            select: {
                // Selected only to look up the seller's bank details below. The
                // token carries no tenant context by design, so the row is the
                // only place the tenant can come from. `toPublicQuotation` is an
                // allow-list and does not copy it, so it cannot reach the page.
                tenant_id: true,
                quote_number: true,
                version: true,
                status: true,
                created_at: true,
                valid_until: true,
                notes: true,
                total_amount: true,
                doc_kind: true,
                currency: true,
                incoterm: true,
                port_of_loading: true,
                port_of_discharge: true,
                payment_terms: true,
                advance_percent: true,
                delivery_lead_time_days: true,
                country_of_origin: true,
                // exchange_rate is deliberately NOT selected. It is the seller's
                // internal translation for their own ledger; a buyer reading a
                // USD proforma has no business being shown what the seller
                // expects to book it at.
                customer: { select: { name: true } },
                store: { select: { name: true } },
                items: {
                    // QuotationItem has no sort column, so `id` is the only stable
                    // order available. Without it Postgres is free to return rows
                    // in any order, which on a customer-facing document means the
                    // printed line order can differ between two loads of the same
                    // link — and from the internal page the shop owner is reading.
                    orderBy: { id: 'asc' },
                    select: {
                        quantity: true,
                        unit_price: true,
                        product: { select: { name: true } },
                    },
                },
            },
        });
        if (!quote) throw new NotFoundException('This link is no longer available');

        // Only a proforma carries remittance details, and only when the tenant
        // has filled them in. A quote is not a request for payment, so putting
        // a bank account on one invites a buyer to pay against a document the
        // seller has not committed to.
        const bank = quote.doc_kind === 'PROFORMA'
            ? await this.db.salesSettings.findUnique({
                  where: { tenant_id: quote.tenant_id },
                  select: {
                      bank_name: true,
                      bank_branch: true,
                      bank_account_name: true,
                      bank_account_number: true,
                      bank_routing_number: true,
                      bank_swift_code: true,
                  },
              })
            : null;

        return toPublicQuotation(quote, bank);
    }
}

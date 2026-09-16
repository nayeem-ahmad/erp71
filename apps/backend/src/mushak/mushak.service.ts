import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
    MUSHAK_FORMS,
    MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT,
    MushakForm,
    checkMushakIssuer,
    computeSaleTax,
    mushakSupplyUnit,
    resolveTaxRate,
    roundMoney,
    type MushakIssuerReadiness,
} from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { zonedDayRange } from '../common/tenant-time.util';
import { GetMushakPeriodDto, GetSalesBookDto } from './mushak.dto';

/**
 * The NBR Mushak 6.x documents the sales module can produce.
 *
 * Every figure here comes from what was stored when the sale was posted, not
 * from today's catalogue — see `sale-tax.util.ts`. The one exception is a sale
 * written before those columns existed, which is flagged `estimated` on the
 * document rather than quietly presented as a snapshot.
 *
 * Statutory shape lives in `@erp71/shared-types/mushak`: form titles, rule
 * citations, the tax arithmetic and the two-lakh threshold. This service is
 * only the query and the assembly.
 */

/** The issuer block every 6.x document carries at the top. */
export interface MushakIssuer {
    name: string;
    bin: string | null;
    tin: string | null;
    address: string | null;
    economicActivity: string | null;
    officerName: string | null;
    officerDesignation: string | null;
    readiness: MushakIssuerReadiness;
}

export interface MushakParty {
    name: string;
    bin: string | null;
    nid: string | null;
    address: string | null;
    phone: string | null;
}

export interface MushakDocumentLine {
    serial: number;
    description: string;
    sku: string | null;
    unitBn: string;
    unitEn: string;
    quantity: number;
    /** একক মূল্য — per unit, excluding VAT and SD. */
    unitValue: number;
    /** মোট মূল্য — line value, excluding VAT and SD. */
    totalValue: number;
    sdRate: number;
    sdAmount: number;
    vatRate: number;
    vatAmount: number;
    /** সকল প্রকার শুল্ক ও করসহ মূল্য. */
    inclusiveTotal: number;
}

export interface MushakDocumentTotals {
    totalValue: number;
    sdAmount: number;
    vatAmount: number;
    inclusiveTotal: number;
}

const WALK_IN_BUYER: MushakParty = {
    name: 'Walk-in customer',
    bin: null,
    nid: null,
    address: null,
    phone: null,
};

const TENANT_ISSUER_FIELDS = {
    name: true,
    brand_business_name: true,
    vat_registration_no: true,
    business_tin: true,
    business_type: true,
    default_vat_rate: true,
    mushak_enabled: true,
    mushak_issue_address: true,
    mushak_officer_name: true,
    mushak_officer_designation: true,
    mushak_economic_activity: true,
} as const;

@Injectable()
export class MushakService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * What this build can and cannot produce. Served to the UI so a workspace
     * is told plainly which of the eleven 6.x forms it still has to keep by
     * hand, rather than being left to infer it from an empty menu.
     */
    async getFormCatalogue(tenantId: string) {
        const tenant = await this.loadTenant(tenantId);
        return {
            enabled: tenant.mushak_enabled === true,
            issuer: this.toIssuer(tenant),
            forms: MUSHAK_FORMS.map((form) => ({ ...form })),
        };
    }

    // ── মূসক-৬.৩ · কর চালানপত্র (tax invoice) ────────────────────────────────

    async getTaxInvoice(tenantId: string, saleId: string) {
        const [sale, tenant] = await Promise.all([
            this.db.sale.findFirst({
                where: { id: saleId, tenant_id: tenantId },
                include: {
                    items: {
                        include: { product: { select: { name: true, sku: true, unit_type: true, vat_rate: true, sd_rate: true } } },
                    },
                    customer: true,
                    store: { select: { name: true, address: true } },
                },
            }),
            this.loadTenant(tenantId),
        ]);

        if (!sale) throw new NotFoundException('Sale not found');

        // A draft has posted nothing — no stock has moved and no supply has
        // been made — so there is no supply to raise a tax invoice for. A
        // cancelled one was reversed; its 6.3, if any was issued, is undone by
        // a 6.7 credit note rather than by reprinting the invoice.
        if (sale.status === 'DRAFT') {
            throw new BadRequestException(
                'This sale is still a draft. Complete it before issuing a Mushak 6.3 tax invoice.',
            );
        }

        const { lines, totals, estimated } = this.buildLines(sale, tenant);

        return {
            form: MushakForm.TAX_INVOICE,
            issuer: this.toIssuer(tenant),
            buyer: this.toBuyer(sale.customer),
            invoice: {
                saleId: sale.id,
                number: sale.reference_number || sale.serial_number,
                serialNumber: sale.serial_number,
                // Rule 40 wants the date AND the time of issue in separate
                // boxes; both come off one instant, which the frontend renders
                // in the workspace's timezone.
                issuedAt: sale.sale_date ?? sale.created_at,
                status: sale.status,
                cancelled: sale.status === 'CANCELLED',
                destination: sale.mushak_destination ?? sale.customer?.address ?? null,
                vehicleNo: sale.mushak_vehicle_no ?? null,
                branch: sale.store?.name ?? null,
            },
            lines,
            totals,
            /**
             * True when at least one line predates the tax snapshot and had to
             * be priced from today's catalogue. The document is still printed —
             * a shop reconstructing last year's books needs it — but it says so,
             * because the figures are a reconstruction and not a reprint.
             */
            estimated,
        };
    }

    // ── মূসক-৬.৭ · ক্রেডিট নোট (credit note) ─────────────────────────────────

    async getCreditNote(tenantId: string, returnId: string) {
        const [salesReturn, tenant] = await Promise.all([
            this.db.salesReturn.findFirst({
                where: { id: returnId, tenant_id: tenantId },
                include: {
                    items: {
                        include: {
                            product: { select: { name: true, sku: true, unit_type: true, vat_rate: true, sd_rate: true } },
                            sale_item: true,
                        },
                    },
                    sale: { include: { customer: true } },
                    store: { select: { name: true } },
                },
            }),
            this.loadTenant(tenantId),
        ]);

        if (!salesReturn) throw new NotFoundException('Sales return not found');

        // Rule 40(1)(ঞ): a credit note reduces the value of a supply that was
        // already invoiced, so it has to name the চালানপত্র it reduces. A
        // return recorded with no parent sale — goods from before the business
        // moved onto this system — has nothing to reduce and cannot be one.
        if (!salesReturn.sale) {
            throw new BadRequestException(
                'A Mushak 6.7 credit note must reference the tax invoice it reduces. '
                + 'This return was recorded without a linked sale.',
            );
        }

        const tenantVatRate = this.tenantVatRate(tenant);
        let estimated = false;

        const taxLines = salesReturn.items.map((item: any, index: number) => {
            // The rate the original supply was taxed at, not today's — a credit
            // note has to unwind the invoice it references at the rate that
            // invoice carried.
            const snapshot = item.sale_item?.vat_rate != null;
            if (!snapshot) estimated = true;
            const vatRate = snapshot
                ? Number(item.sale_item.vat_rate)
                : resolveTaxRate(
                      item.product?.vat_rate != null ? Number(item.product.vat_rate) : null,
                      tenantVatRate,
                  );
            const sdRate = snapshot
                ? Number(item.sale_item.sd_rate ?? 0)
                : item.product?.sd_rate != null
                    ? Number(item.product.sd_rate)
                    : 0;

            return {
                key: String(index),
                quantity: item.quantity,
                unitPrice: item.quantity > 0 ? roundMoney(Number(item.refund_amount) / item.quantity) : 0,
                vatRate,
                sdRate,
            };
        });

        // The refund total is authoritative; the lines are already priced from
        // the sale, so nothing is reallocated here.
        const tax = computeSaleTax(taxLines);

        const lines: MushakDocumentLine[] = salesReturn.items.map((item: any, index: number) => {
            const unit = mushakSupplyUnit(item.product?.unit_type);
            const line = tax.lines[index];
            return {
                serial: index + 1,
                description: item.product?.name ?? 'Item',
                sku: item.product?.sku ?? null,
                unitBn: unit.bn,
                unitEn: unit.en,
                quantity: item.quantity,
                unitValue: item.quantity > 0 ? roundMoney(line.taxableValue / item.quantity) : 0,
                totalValue: line.taxableValue,
                sdRate: line.sdRate,
                sdAmount: line.sdAmount,
                vatRate: line.vatRate,
                vatAmount: line.vatAmount,
                inclusiveTotal: line.inclusiveTotal,
            };
        });

        return {
            form: MushakForm.CREDIT_NOTE,
            issuer: this.toIssuer(tenant),
            buyer: this.toBuyer(salesReturn.sale.customer),
            note: {
                returnId: salesReturn.id,
                number: salesReturn.return_number,
                issuedAt: salesReturn.created_at,
                /** হ্রাসের কারণ — why the value of the supply fell. */
                reason: salesReturn.reason ?? null,
                branch: salesReturn.store?.name ?? null,
            },
            /** The চালানপত্র this note reduces. */
            against: {
                saleId: salesReturn.sale.id,
                number: salesReturn.sale.reference_number || salesReturn.sale.serial_number,
                issuedAt: salesReturn.sale.sale_date ?? salesReturn.sale.created_at,
            },
            lines,
            totals: this.sumLines(lines),
            estimated,
        };
    }

    // ── মূসক-৬.২ · বিক্রয় হিসাব পুস্তক (sales book) ──────────────────────────

    async getSalesBook(tenantId: string, query: GetSalesBookDto, timezone: string) {
        const tenant = await this.loadTenant(tenantId);
        const period = zonedDayRange(query.from, query.to, timezone);

        const sales = await this.db.sale.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.storeId ? { store_id: query.storeId } : {}),
                ...(period ? { sale_date: period } : {}),
                // A draft is not a supply and a cancelled sale is one that was
                // unwound; neither belongs in the book NBR inspects.
                status: { notIn: ['DRAFT', 'CANCELLED'] },
            },
            include: {
                items: {
                    include: { product: { select: { name: true, unit_type: true, vat_rate: true, sd_rate: true } } },
                },
                customer: { select: { name: true, address: true, bin: true, nid: true, phone: true } },
                store: { select: { name: true } },
            },
            orderBy: [{ sale_date: 'asc' }, { created_at: 'asc' }],
        });

        const taxableOnly = query.taxableOnly === 'true' || query.taxableOnly === '1';
        let estimated = false;

        const entries = sales.map((sale: any) => {
            const built = this.buildLines(sale, tenant);
            if (built.estimated) estimated = true;
            const buyer = this.toBuyer(sale.customer);
            return {
                saleId: sale.id,
                date: sale.sale_date ?? sale.created_at,
                invoiceNumber: sale.reference_number || sale.serial_number,
                buyer,
                branch: sale.store?.name ?? null,
                /** Column ৭ takes a description of the supply, not a line each. */
                description: this.describeSupply(built.lines),
                quantity: built.lines.reduce((sum, line) => sum + line.quantity, 0),
                ...built.totals,
            };
        });

        const rows = taxableOnly
            ? entries.filter((entry) => entry.vatAmount > 0 || entry.sdAmount > 0)
            : entries;

        return {
            form: MushakForm.SALES_BOOK,
            issuer: this.toIssuer(tenant),
            period: { from: query.from ?? null, to: query.to ?? null, timezone },
            filters: { storeId: query.storeId ?? null, taxableOnly },
            rows,
            totals: {
                invoices: rows.length,
                totalValue: roundMoney(rows.reduce((sum, r) => sum + r.totalValue, 0)),
                sdAmount: roundMoney(rows.reduce((sum, r) => sum + r.sdAmount, 0)),
                vatAmount: roundMoney(rows.reduce((sum, r) => sum + r.vatAmount, 0)),
                inclusiveTotal: roundMoney(rows.reduce((sum, r) => sum + r.inclusiveTotal, 0)),
            },
            estimated,
        };
    }

    // ── মূসক-৬.১০ · ২ লক্ষ টাকার ঊর্ধ্বে সরবরাহের তালিকা ─────────────────────

    async getLargeSupplyStatement(tenantId: string, query: GetMushakPeriodDto, timezone: string) {
        const book = await this.getSalesBook(
            tenantId,
            { from: query.from, to: query.to, storeId: query.storeId },
            timezone,
        );

        // Rule 40(1)(ড) lists supplies to buyers who are NOT registered. A
        // buyer with a BIN is on the 6.2 and accounts for the supply through
        // their own input credit, so they are deliberately excluded here.
        const rows = book.rows.filter(
            (row) =>
                !row.buyer.bin
                && row.inclusiveTotal >= MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT,
        );

        return {
            form: MushakForm.LARGE_SUPPLY_STATEMENT,
            issuer: book.issuer,
            period: book.period,
            filters: { storeId: query.storeId ?? null },
            threshold: MUSHAK_LARGE_SUPPLY_THRESHOLD_BDT,
            rows,
            totals: {
                invoices: rows.length,
                totalValue: roundMoney(rows.reduce((sum, r) => sum + r.totalValue, 0)),
                sdAmount: roundMoney(rows.reduce((sum, r) => sum + r.sdAmount, 0)),
                vatAmount: roundMoney(rows.reduce((sum, r) => sum + r.vatAmount, 0)),
                inclusiveTotal: roundMoney(rows.reduce((sum, r) => sum + r.inclusiveTotal, 0)),
            },
            estimated: book.estimated,
        };
    }

    // ── internals ───────────────────────────────────────────────────────────

    private async loadTenant(tenantId: string) {
        const tenant = await this.db.tenant.findUnique({
            where: { id: tenantId },
            select: TENANT_ISSUER_FIELDS,
        });
        if (!tenant) throw new NotFoundException('Workspace not found');
        return tenant;
    }

    private tenantVatRate(tenant: { default_vat_rate?: any }): number | null {
        return tenant.default_vat_rate != null ? Number(tenant.default_vat_rate) : null;
    }

    private toIssuer(tenant: any): MushakIssuer {
        return {
            name: tenant.brand_business_name || tenant.name,
            bin: tenant.vat_registration_no ?? null,
            tin: tenant.business_tin ?? null,
            address: tenant.mushak_issue_address ?? null,
            economicActivity: tenant.mushak_economic_activity ?? tenant.business_type ?? null,
            officerName: tenant.mushak_officer_name ?? null,
            officerDesignation: tenant.mushak_officer_designation ?? null,
            readiness: checkMushakIssuer(tenant),
        };
    }

    private toBuyer(customer: any): MushakParty {
        if (!customer) return { ...WALK_IN_BUYER };
        return {
            name: customer.name,
            bin: customer.bin ?? null,
            nid: customer.nid ?? null,
            address: customer.address ?? null,
            phone: customer.phone ?? null,
        };
    }

    /**
     * A sale's lines in 6.3 column order.
     *
     * The rates come from the snapshot taken when the sale was posted — that is
     * what makes a reprint a reprint. The money is then re-derived from those
     * rates against `total_amount`, rather than read straight off the line, so
     * that an invoice-level reduction (a promo code, redeemed points, a typed
     * discount) is spread over the lines here exactly as it was at posting
     * time. `price_at_sale * quantity` is the *undiscounted* price, so a
     * document built from it would declare more value and more output VAT than
     * the invoice it is supposed to reproduce, and would not foot to its own
     * total.
     *
     * The arithmetic is `computeSaleTax`, the same function the snapshot was
     * written with, fed the same inputs — so the per-line figures it returns
     * are the stored ones, and the two can never drift.
     *
     * A line written before the snapshot columns existed carries no rate at
     * all. It falls back to the catalogue so the document is still printable —
     * a shop reconstructing last year's books needs it — and the caller is told
     * via `estimated` that this happened.
     */
    private buildLines(
        sale: any,
        tenant: any,
    ): { lines: MushakDocumentLine[]; totals: MushakDocumentTotals; estimated: boolean } {
        const tenantVatRate = this.tenantVatRate(tenant);
        const missingSnapshot = sale.items.some((item: any) => item.vat_rate == null);

        const tax = computeSaleTax(
            sale.items.map((item: any, index: number) => ({
                key: String(index),
                quantity: item.quantity,
                unitPrice: Number(item.price_at_sale),
                vatRate: item.vat_rate != null
                    ? Number(item.vat_rate)
                    : resolveTaxRate(
                          item.product?.vat_rate != null ? Number(item.product.vat_rate) : null,
                          tenantVatRate,
                      ),
                sdRate: item.sd_rate != null
                    ? Number(item.sd_rate)
                    : item.product?.sd_rate != null
                        ? Number(item.product.sd_rate)
                        : 0,
            })),
            Number(sale.total_amount),
        );

        const lines: MushakDocumentLine[] = sale.items.map((item: any, index: number) => {
            const unit = mushakSupplyUnit(item.product?.unit_type);
            const line = tax.lines[index];
            return {
                serial: index + 1,
                description: item.product?.name ?? 'Item',
                sku: item.product?.sku ?? null,
                unitBn: unit.bn,
                unitEn: unit.en,
                quantity: item.quantity,
                unitValue: item.quantity > 0 ? roundMoney(line.taxableValue / item.quantity) : 0,
                totalValue: line.taxableValue,
                sdRate: line.sdRate,
                sdAmount: line.sdAmount,
                vatRate: line.vatRate,
                vatAmount: line.vatAmount,
                inclusiveTotal: line.inclusiveTotal,
            };
        });

        return { lines, totals: this.sumLines(lines), estimated: missingSnapshot };
    }

    private sumLines(lines: MushakDocumentLine[]): MushakDocumentTotals {
        return {
            totalValue: roundMoney(lines.reduce((sum, l) => sum + l.totalValue, 0)),
            sdAmount: roundMoney(lines.reduce((sum, l) => sum + l.sdAmount, 0)),
            vatAmount: roundMoney(lines.reduce((sum, l) => sum + l.vatAmount, 0)),
            inclusiveTotal: roundMoney(lines.reduce((sum, l) => sum + l.inclusiveTotal, 0)),
        };
    }

    /**
     * Column ৭ of the 6.2 takes one description per invoice, not one per line.
     * Naming the first two items and counting the rest is what a hand-kept
     * book does, and keeps the column readable on a fifty-line invoice.
     */
    private describeSupply(lines: MushakDocumentLine[]): string {
        if (lines.length === 0) return '—';
        const named = lines.slice(0, 2).map((line) => line.description);
        const remaining = lines.length - named.length;
        return remaining > 0 ? `${named.join(', ')} +${remaining} more` : named.join(', ');
    }
}

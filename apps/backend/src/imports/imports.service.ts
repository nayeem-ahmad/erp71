import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import { applyInventoryMovement, resolveWarehouseId } from '../database/inventory.utils';
import { allocateLandedCost, AllocationBasis } from '../database/landed-cost.utils';
import { DocumentSeries, nextDocumentNumber } from '../database/document-number.utils';
import { postMultiLeg } from '../accounting/posting.utils';
import {
    CAPITALIZED_BY_DEFAULT,
    DEFAULT_BASIS_BY_COST_TYPE,
    ImportAccount,
    ImportCostType,
    RECEIVABLE_ACCOUNT_BY_COST_TYPE,
    ShipmentStatus,
    STATUS_SET_BY_ACTION,
    canTransition,
} from './imports.constants';
import {
    CreateImportCostDto,
    CreateImportDocumentDto,
    CreateImportShipmentDto,
    ReceiveShipmentDto,
    SettleShipmentDto,
    UpdateImportCostDto,
    UpdateImportShipmentDto,
} from './imports.dto';

const num = (value: unknown) => Number(value ?? 0);

/**
 * Imports under a Letter of Credit.
 *
 * The design decision the whole module rests on: **receiving a shipment emits
 * an ordinary `Purchase` at landed cost rather than replacing it.** Once
 * `purchase_id` is set, `ProductCost`, `InventoryMovement`, the supplier ledger
 * and every purchase report work on it unchanged, with no knowledge that these
 * goods were imported. That is what keeps a months-long, multi-currency,
 * many-charge process from leaking into the rest of the system.
 *
 * See docs/lc-imports-and-proforma-invoice-plan.md §4.
 */
@Injectable()
export class ImportsService {
    constructor(private readonly db: DatabaseService) {}

    // ── Helpers ──────────────────────────────────────────────────────────────

    /**
     * Resolves a seeded account by name.
     *
     * By name rather than by code, matching how `autoPostFromRules` resolves
     * rule accounts: a tenant may renumber their chart, but the names
     * `bootstrap-accounting.ts` seeds are what the posting rules already depend
     * on. A missing account means the tenant predates the import chart, and the
     * error says so rather than posting a lopsided entry.
     */
    private async accountIdByName(tx: Prisma.TransactionClient, tenantId: string, name: string): Promise<string> {
        const account = await tx.account.findFirst({
            where: { tenant_id: tenantId, name },
            select: { id: true },
        });
        if (!account) {
            throw new BadRequestException(
                `Account "${name}" is not set up for this workspace. Run the accounting bootstrap to add the import accounts.`,
            );
        }
        return account.id;
    }

    private async getShipmentOrThrow(tenantId: string, id: string) {
        const shipment = await this.db.importShipment.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                supplier: true,
                items: { include: { product: true }, orderBy: { id: 'asc' } },
                costs: { orderBy: { created_at: 'asc' } },
                documents: { orderBy: { created_at: 'desc' } },
            },
        });
        if (!shipment) throw new NotFoundException('Import shipment not found');
        return shipment;
    }

    /**
     * Refuses a change to a shipment whose goods are already on the shelf.
     *
     * After receipt the landed cost has been written into `ProductCost` and the
     * stock has moved. Editing items or adding a capitalised cost then would
     * silently disagree with the inventory it produced — see the plan's open
     * question 3 on late C&F bills, which is deliberately still open.
     */
    private assertOpen(shipment: { status: string; purchase_id: string | null }) {
        if (shipment.purchase_id || shipment.status === ShipmentStatus.RECEIVED || shipment.status === ShipmentStatus.CLOSED) {
            throw new BadRequestException(
                'This shipment has been received. Its costs and items can no longer be changed.',
            );
        }
        if (shipment.status === ShipmentStatus.CANCELLED) {
            throw new BadRequestException('This shipment has been cancelled.');
        }
    }

    private toBdt(amount: number, currency: string, fxRate?: number | null): number {
        if (currency === 'BDT') return amount;
        if (!fxRate) {
            throw new BadRequestException(`An exchange rate is required for an amount in ${currency}.`);
        }
        return Math.round(amount * fxRate * 100) / 100;
    }

    private shipmentColumns(dto: Partial<CreateImportShipmentDto>) {
        const data: Record<string, unknown> = {};
        const date = (value?: string) => (value ? new Date(value) : null);

        if (dto.supplierId !== undefined) data.supplier_id = dto.supplierId || null;
        if (dto.customerPiId !== undefined) data.customer_pi_id = dto.customerPiId || null;
        if (dto.currency !== undefined) data.currency = dto.currency.toUpperCase();
        if (dto.fxRateAtOpen !== undefined) data.fx_rate_at_open = dto.fxRateAtOpen;
        if (dto.lcNumber !== undefined) data.lc_number = dto.lcNumber || null;
        if (dto.lcType !== undefined) data.lc_type = dto.lcType || null;
        if (dto.lcDate !== undefined) data.lc_date = date(dto.lcDate);
        if (dto.lcExpiryDate !== undefined) data.lc_expiry_date = date(dto.lcExpiryDate);
        if (dto.latestShipmentDate !== undefined) data.latest_shipment_date = date(dto.latestShipmentDate);
        if (dto.bankName !== undefined) data.bank_name = dto.bankName || null;
        if (dto.bankBranch !== undefined) data.bank_branch = dto.bankBranch || null;
        if (dto.marginPercent !== undefined) data.margin_percent = dto.marginPercent;
        if (dto.tenorDays !== undefined) data.tenor_days = dto.tenorDays;
        if (dto.incoterm !== undefined) data.incoterm = dto.incoterm || null;
        if (dto.blNumber !== undefined) data.bl_number = dto.blNumber || null;
        if (dto.blDate !== undefined) data.bl_date = date(dto.blDate);
        if (dto.vesselName !== undefined) data.vessel_name = dto.vesselName || null;
        if (dto.portOfLoading !== undefined) data.port_of_loading = dto.portOfLoading || null;
        if (dto.portOfDischarge !== undefined) data.port_of_discharge = dto.portOfDischarge || null;
        if (dto.etd !== undefined) data.etd = date(dto.etd);
        if (dto.eta !== undefined) data.eta = date(dto.eta);
        if (dto.beNumber !== undefined) data.be_number = dto.beNumber || null;
        if (dto.beDate !== undefined) data.be_date = date(dto.beDate);
        if (dto.cfAgentName !== undefined) data.cf_agent_name = dto.cfAgentName || null;
        if (dto.notes !== undefined) data.notes = dto.notes || null;

        return data;
    }

    /**
     * Item rows, with the product's customs figures snapshotted onto them.
     *
     * Snapshotted because a product's HS code can be corrected later and this
     * shipment was assessed under the old one — a reclassification must not
     * retroactively rewrite how past entries were assessed.
     */
    private async itemRows(
        tx: Prisma.TransactionClient,
        tenantId: string,
        items: CreateImportShipmentDto['items'],
    ) {
        const productIds = [...new Set(items.map((item) => item.productId))];
        const products = await tx.product.findMany({
            where: { tenant_id: tenantId, id: { in: productIds } },
            select: { id: true, hs_code: true, net_weight_kg: true, cbm: true },
        });

        if (products.length !== productIds.length) {
            throw new BadRequestException('One or more products do not exist for this workspace.');
        }

        const byId = new Map(products.map((product) => [product.id, product]));

        return items.map((item) => {
            const product = byId.get(item.productId)!;
            return {
                product_id: item.productId,
                quantity: item.quantity,
                unit_price_fc: new Prisma.Decimal(item.unitPriceFc),
                hs_code: item.hsCode ?? product.hs_code ?? null,
                net_weight_kg: item.netWeightKg ?? product.net_weight_kg ?? null,
                cbm: item.cbm ?? product.cbm ?? null,
            };
        });
    }

    private invoiceValueFc(items: CreateImportShipmentDto['items']) {
        return items.reduce((sum, item) => sum + item.quantity * item.unitPriceFc, 0);
    }

    // ── Shipments ────────────────────────────────────────────────────────────

    async create(tenantId: string, userId: string, dto: CreateImportShipmentDto) {
        const currency = dto.currency.toUpperCase();
        if (currency !== 'BDT' && !dto.fxRateAtOpen) {
            throw new BadRequestException(`An exchange rate is required for a shipment in ${currency}.`);
        }

        const store = await this.db.store.findFirst({ where: { id: dto.storeId, tenant_id: tenantId } });
        if (!store) throw new NotFoundException('Store not found');

        if (dto.supplierId) {
            const supplier = await this.db.supplier.findFirst({
                where: { id: dto.supplierId, tenant_id: tenantId },
            });
            if (!supplier) throw new BadRequestException('Supplier not found for this workspace.');
        }

        return this.db.$transaction(async (tx) => {
            const referenceNumber = await nextDocumentNumber(tx, {
                tenantId,
                series: DocumentSeries.IMPORT_SHIPMENT,
            });

            const items = await this.itemRows(tx, tenantId, dto.items);

            return tx.importShipment.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    reference_number: referenceNumber,
                    status: ShipmentStatus.DRAFT,
                    created_by: userId,
                    invoice_value_fc: new Prisma.Decimal(this.invoiceValueFc(dto.items)),
                    ...this.shipmentColumns({ ...dto, currency }),
                    items: { create: items },
                },
                include: { items: { include: { product: true } }, supplier: true },
            });
        });
    }

    async findAll(
        tenantId: string,
        opts?: { status?: string; supplierId?: string; openOnly?: boolean },
    ) {
        const closedStates = [ShipmentStatus.RECEIVED, ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED];

        return this.db.importShipment.findMany({
            where: {
                tenant_id: tenantId,
                ...(opts?.status ? { status: opts.status } : {}),
                ...(opts?.supplierId ? { supplier_id: opts.supplierId } : {}),
                ...(opts?.openOnly ? { status: { notIn: closedStates } } : {}),
            },
            include: {
                supplier: { select: { id: true, name: true, country: true } },
                items: { select: { id: true, quantity: true } },
                costs: { select: { amount_bdt: true, is_capitalized: true } },
            },
            orderBy: { created_at: 'desc' },
        });
    }

    async findOne(tenantId: string, id: string) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);
        return { ...shipment, cost_sheet: this.buildCostSheet(shipment) };
    }

    async update(tenantId: string, id: string, dto: UpdateImportShipmentDto) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);
        this.assertOpen(shipment);

        const currency = (dto.currency ?? shipment.currency).toUpperCase();
        const fxRate = dto.fxRateAtOpen ?? (num(shipment.fx_rate_at_open) || null);
        if (currency !== 'BDT' && !fxRate) {
            throw new BadRequestException(`An exchange rate is required for a shipment in ${currency}.`);
        }

        return this.db.$transaction(async (tx) => {
            const data: Record<string, unknown> = this.shipmentColumns(dto);

            if (dto.items && dto.items.length > 0) {
                await tx.importShipmentItem.deleteMany({ where: { shipment_id: id } });
                data.items = { create: await this.itemRows(tx, tenantId, dto.items) };
                data.invoice_value_fc = new Prisma.Decimal(this.invoiceValueFc(dto.items));
            }

            return tx.importShipment.update({
                where: { id },
                data,
                include: { items: { include: { product: true } }, supplier: true, costs: true },
            });
        });
    }

    async updateStatus(tenantId: string, id: string, status: string) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);

        if (STATUS_SET_BY_ACTION.includes(status)) {
            // Reachable only through `receive`, which writes a Purchase and
            // moves stock. Allowing it here would leave a shipment claiming to
            // be received with no goods and no purchase behind it.
            throw new BadRequestException('Use the receive action to mark a shipment received.');
        }

        if (!canTransition(shipment.status, status)) {
            throw new BadRequestException(`A shipment cannot move from ${shipment.status} to ${status}.`);
        }

        return this.db.importShipment.update({ where: { id }, data: { status } });
    }

    async remove(tenantId: string, id: string) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);

        if (shipment.purchase_id) {
            throw new BadRequestException('A received shipment cannot be deleted.');
        }
        if (shipment.costs.length > 0) {
            // Costs have posted to the ledger. Deleting the shipment would
            // orphan those vouchers; cancelling keeps the audit trail.
            throw new BadRequestException(
                'This shipment has costs recorded against it. Cancel it instead of deleting.',
            );
        }

        await this.db.importShipment.delete({ where: { id } });
        return { deleted: true };
    }

    // ── Costs ────────────────────────────────────────────────────────────────

    /**
     * Records a charge against a shipment and posts it.
     *
     * Two shapes, decided by `is_capitalized`:
     *
     * - **Capitalised** (freight, duty, C&F, port, transport) — Dr Goods in
     *   Transit / Cr wherever the money came from. It becomes part of what the
     *   goods cost and reaches inventory at receipt.
     * - **Not capitalised** (VAT, AIT, LC margin, bank charges) — Dr the
     *   receivable or expense account / Cr the source. It never touches
     *   inventory. Capitalising rebatable VAT is the single most common
     *   landed-cost error and overstates COGS on every later sale.
     *
     * A charge with no `paidFromAccountId` is accrued rather than paid, and is
     * recorded without posting: there is nowhere honest to credit it. It still
     * allocates into the landed cost at receipt, which is what a C&F bill that
     * arrives before payment needs.
     */
    async addCost(tenantId: string, userId: string, shipmentId: string, dto: CreateImportCostDto) {
        const shipment = await this.getShipmentOrThrow(tenantId, shipmentId);
        this.assertOpen(shipment);

        const costType = dto.costType as ImportCostType;
        const currency = (dto.currency ?? 'BDT').toUpperCase();
        const amountBdt = this.toBdt(dto.amount, currency, dto.fxRate);
        const isCapitalized = dto.isCapitalized ?? CAPITALIZED_BY_DEFAULT[costType];
        const basis = dto.allocationBasis ?? DEFAULT_BASIS_BY_COST_TYPE[costType];

        return this.db.$transaction(async (tx) => {
            let receivableAccountId = dto.receivableAccountId ?? null;
            if (!isCapitalized && !receivableAccountId) {
                const defaultName = RECEIVABLE_ACCOUNT_BY_COST_TYPE[costType];
                if (!defaultName) {
                    throw new BadRequestException(
                        `A ${costType} charge that is not capitalised needs an account to post to.`,
                    );
                }
                receivableAccountId = await this.accountIdByName(tx, tenantId, defaultName);
            }

            const cost = await tx.importCost.create({
                data: {
                    tenant_id: tenantId,
                    shipment_id: shipmentId,
                    cost_type: costType,
                    description: dto.description ?? null,
                    currency,
                    amount: new Prisma.Decimal(dto.amount),
                    fx_rate: dto.fxRate ?? null,
                    amount_bdt: new Prisma.Decimal(amountBdt),
                    allocation_basis: basis,
                    is_capitalized: isCapitalized,
                    receivable_account_id: receivableAccountId,
                    paid_from_account_id: dto.paidFromAccountId ?? null,
                    paid_at: dto.paidAt ? new Date(dto.paidAt) : dto.paidFromAccountId ? new Date() : null,
                    created_by: userId,
                },
            });

            if (!dto.paidFromAccountId || amountBdt === 0) {
                return cost;
            }

            const debitAccountId = isCapitalized
                ? await this.accountIdByName(tx, tenantId, ImportAccount.GOODS_IN_TRANSIT)
                : receivableAccountId!;

            const posting = await postMultiLeg({
                tx,
                tenantId,
                eventType: 'import_cost',
                sourceModule: 'imports',
                sourceType: 'import_cost',
                sourceId: cost.id,
                storeId: shipment.store_id,
                description: `${costType} on ${shipment.reference_number}`,
                referenceNumber: shipment.reference_number,
                date: dto.paidAt ? new Date(dto.paidAt) : new Date(),
                legs: [
                    { accountId: debitAccountId, debit: amountBdt, comment: dto.description ?? costType },
                    { accountId: dto.paidFromAccountId, credit: amountBdt },
                ],
            });

            return tx.importCost.update({
                where: { id: cost.id },
                data: { voucher_id: posting.voucherId ?? null },
            });
        });
    }

    async updateCost(tenantId: string, shipmentId: string, costId: string, dto: UpdateImportCostDto) {
        const shipment = await this.getShipmentOrThrow(tenantId, shipmentId);
        this.assertOpen(shipment);

        const cost = shipment.costs.find((row) => row.id === costId);
        if (!cost) throw new NotFoundException('Import cost not found');
        if (cost.voucher_id) {
            // Editing an amount that has already hit the ledger would leave the
            // voucher disagreeing with the row that produced it. Delete and
            // re-add, which reverses cleanly.
            throw new BadRequestException(
                'This cost has already been posted. Delete it and add a corrected one.',
            );
        }

        const costType = (dto.costType ?? cost.cost_type) as ImportCostType;
        const currency = (dto.currency ?? cost.currency).toUpperCase();
        const amount = dto.amount ?? num(cost.amount);
        const fxRate = dto.fxRate ?? (cost.fx_rate == null ? undefined : num(cost.fx_rate));

        return this.db.importCost.update({
            where: { id: costId },
            data: {
                cost_type: costType,
                description: dto.description ?? cost.description,
                currency,
                amount: new Prisma.Decimal(amount),
                fx_rate: fxRate ?? null,
                amount_bdt: new Prisma.Decimal(this.toBdt(amount, currency, fxRate)),
                allocation_basis: dto.allocationBasis ?? cost.allocation_basis,
                is_capitalized: dto.isCapitalized ?? cost.is_capitalized,
            },
        });
    }

    async removeCost(tenantId: string, shipmentId: string, costId: string) {
        const shipment = await this.getShipmentOrThrow(tenantId, shipmentId);
        this.assertOpen(shipment);

        const cost = shipment.costs.find((row) => row.id === costId);
        if (!cost) throw new NotFoundException('Import cost not found');
        if (cost.voucher_id) {
            throw new BadRequestException(
                'This cost has already been posted to the ledger and cannot be deleted.',
            );
        }

        await this.db.importCost.delete({ where: { id: costId } });
        return { deleted: true };
    }

    // ── Documents ────────────────────────────────────────────────────────────

    async addDocument(tenantId: string, userId: string, shipmentId: string, dto: CreateImportDocumentDto) {
        await this.getShipmentOrThrow(tenantId, shipmentId);

        return this.db.importDocument.create({
            data: {
                tenant_id: tenantId,
                shipment_id: shipmentId,
                doc_type: dto.docType,
                file_name: dto.fileName,
                storage_key: dto.storageKey,
                mime_type: dto.mimeType ?? null,
                file_size: dto.fileSize ?? null,
                uploaded_by: userId,
            },
        });
    }

    async removeDocument(tenantId: string, shipmentId: string, documentId: string) {
        const document = await this.db.importDocument.findFirst({
            where: { id: documentId, shipment_id: shipmentId, tenant_id: tenantId },
        });
        if (!document) throw new NotFoundException('Document not found');

        await this.db.importDocument.delete({ where: { id: documentId } });
        return { deleted: true };
    }

    // ── Cost sheet ───────────────────────────────────────────────────────────

    /**
     * What each unit of this shipment costs, and where the money went.
     *
     * The document an importer already keeps by hand in a spreadsheet, and the
     * most useful screen in the module. Computed rather than stored so that it
     * stays correct while costs are still arriving; `landed_unit_cost` on the
     * item is written only once, at receipt, and is what the stock was actually
     * costed at.
     */
    buildCostSheet(shipment: {
        currency: string;
        fx_rate_at_open: unknown;
        items: Array<{
            id: string;
            product_id: string;
            quantity: number;
            unit_price_fc: unknown;
            net_weight_kg: unknown;
            cbm: unknown;
            landed_unit_cost?: unknown;
            product?: { name: string } | null;
        }>;
        costs: Array<{
            cost_type: string;
            description: string | null;
            amount_bdt: unknown;
            allocation_basis: string;
            is_capitalized: boolean;
        }>;
    }) {
        const rate = shipment.currency === 'BDT' ? 1 : num(shipment.fx_rate_at_open);

        const lines = shipment.items.map((item) => ({
            key: item.id,
            quantity: item.quantity,
            // Goods value translated to BDT: the ledger and the cost pool are
            // both BDT, so the allocation has to happen there.
            baseAmount: Math.round(item.quantity * num(item.unit_price_fc) * rate * 100) / 100,
            weightPerUnit: item.net_weight_kg == null ? null : num(item.net_weight_kg),
            cbmPerUnit: item.cbm == null ? null : num(item.cbm),
        }));

        const capitalized = shipment.costs.filter((cost) => cost.is_capitalized);
        const nonCapitalized = shipment.costs.filter((cost) => !cost.is_capitalized);

        const allocation = allocateLandedCost({
            lines,
            charges: capitalized.map((cost) => ({
                label: cost.cost_type,
                amount: num(cost.amount_bdt),
                basis: cost.allocation_basis as AllocationBasis,
            })),
        });

        const byKey = new Map(allocation.lines.map((line) => [line.key, line]));
        const goodsValueBdt = lines.reduce((sum, line) => sum + line.baseAmount, 0);

        return {
            currency: shipment.currency,
            fx_rate: rate,
            goods_value_bdt: Math.round(goodsValueBdt * 100) / 100,
            capitalized_charges_bdt: allocation.totalCharges,
            /** Recoverable: rebatable VAT and creditable AIT, plus financing costs. */
            non_capitalized_bdt:
                Math.round(nonCapitalized.reduce((sum, cost) => sum + num(cost.amount_bdt), 0) * 100) / 100,
            total_landed_bdt: Math.round((goodsValueBdt + allocation.totalCharges) * 100) / 100,
            charges: shipment.costs.map((cost) => ({
                cost_type: cost.cost_type,
                description: cost.description,
                amount_bdt: num(cost.amount_bdt),
                basis: cost.allocation_basis,
                is_capitalized: cost.is_capitalized,
            })),
            items: shipment.items.map((item) => {
                const allocated = byKey.get(item.id);
                return {
                    item_id: item.id,
                    product_id: item.product_id,
                    product_name: item.product?.name ?? '',
                    quantity: item.quantity,
                    unit_price_fc: num(item.unit_price_fc),
                    goods_value_bdt: allocated?.baseAmount ?? 0,
                    allocated_charges_bdt: allocated?.allocatedAmount ?? 0,
                    landed_total_bdt: allocated?.landedAmount ?? 0,
                    /** What receipt will stamp on the inventory movement. */
                    projected_unit_cost: allocated?.landedUnitCost ?? 0,
                    /** What it actually was stamped at, once received. */
                    landed_unit_cost: item.landed_unit_cost == null ? null : num(item.landed_unit_cost),
                };
            }),
        };
    }

    // ── Receipt ──────────────────────────────────────────────────────────────

    /**
     * Receives the shipment: emits a `Purchase` at landed cost and moves stock.
     *
     * **This is the join back to the ordinary purchase pipeline.** Everything
     * downstream — `ProductCost.avg_cost`, `InventoryMovement`, the supplier
     * ledger, every purchase report — then operates on a normal purchase with
     * no knowledge that these goods were imported. That is the whole reason the
     * module can hold a months-long multi-currency process without leaking into
     * the rest of the system.
     *
     * The accounting is one balanced multi-leg entry:
     *
     *     Dr Inventory (Purchases)  landed total
     *         Cr Goods in Transit       capitalised charges already booked there
     *         Cr Purchase Payable       the supplier's invoice, in BDT
     *
     * which is exactly why `postMultiLeg` had to exist: `autoPostFromRules` can
     * only write two legs.
     */
    async receive(tenantId: string, userId: string, id: string, dto: ReceiveShipmentDto) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);

        if (shipment.purchase_id) {
            throw new BadRequestException('This shipment has already been received.');
        }
        if (shipment.status === ShipmentStatus.CANCELLED) {
            throw new BadRequestException('A cancelled shipment cannot be received.');
        }
        if (shipment.items.length === 0) {
            throw new BadRequestException('This shipment has no items to receive.');
        }

        const rate = shipment.currency === 'BDT' ? 1 : num(shipment.fx_rate_at_open);
        if (!rate) {
            throw new BadRequestException(
                `This shipment is in ${shipment.currency} but carries no exchange rate, so it cannot be costed.`,
            );
        }

        const sheet = this.buildCostSheet(shipment);
        const receivedAt = dto.receivedAt ? new Date(dto.receivedAt) : new Date();

        return this.db.$transaction(async (tx) => {
            const warehouseId = await resolveWarehouseId(tx, tenantId, shipment.store_id, dto.warehouseId, 'purchase');

            // Derived from the shipment's own reference rather than drawn from
            // a counter: `reference_number` is already unique per tenant, so
            // this is too, it cannot collide with the ordinary `PUR-00001`
            // series, and the purchase names the shipment that produced it —
            // `PUR-IMP-2526-00007`.
            const purchaseNumber = `PUR-${shipment.reference_number}`;

            const purchase = await tx.purchase.create({
                data: {
                    tenant_id: tenantId,
                    store_id: shipment.store_id,
                    supplier_id: shipment.supplier_id,
                    purchase_number: purchaseNumber,
                    reference_number: shipment.reference_number,
                    // The bill is the supplier's invoice. Duty and freight are
                    // owed to Customs and the shipping line, not to the
                    // supplier, so they are NOT part of the payable — only of
                    // the inventory value.
                    subtotal_amount: new Prisma.Decimal(sheet.goods_value_bdt),
                    freight_amount: new Prisma.Decimal(0),
                    total_amount: new Prisma.Decimal(sheet.goods_value_bdt),
                    notes: dto.notes ?? `Import ${shipment.reference_number}`,
                    created_by: userId,
                    created_at: receivedAt,
                },
            });

            for (const item of shipment.items) {
                const costed = sheet.items.find((row) => row.item_id === item.id)!;

                await tx.purchaseItem.create({
                    data: {
                        purchase_id: purchase.id,
                        product_id: item.product_id,
                        quantity: item.quantity,
                        // The supplier's price in BDT, so the bill reconciles to
                        // the invoice. The landed figure goes to inventory only.
                        unit_cost: new Prisma.Decimal(Math.round(num(item.unit_price_fc) * rate * 10000) / 10000),
                        line_total: new Prisma.Decimal(costed.goods_value_bdt),
                    },
                });

                await tx.importShipmentItem.update({
                    where: { id: item.id },
                    data: { landed_unit_cost: new Prisma.Decimal(costed.projected_unit_cost) },
                });

                await applyInventoryMovement(tx, {
                    tenantId,
                    productId: item.product_id,
                    warehouseId,
                    quantityDelta: item.quantity,
                    movementType: 'PURCHASE_RECEIPT',
                    referenceType: 'PURCHASE',
                    referenceId: purchase.id,
                    unitCost: costed.projected_unit_cost,
                    occurredAt: receivedAt,
                });
            }

            if (shipment.supplier_id) {
                const supplier = await tx.supplier.findFirst({
                    where: { id: shipment.supplier_id, tenant_id: tenantId },
                    select: { due_balance: true },
                });
                const balanceAfter = num(supplier?.due_balance) + sheet.goods_value_bdt;

                await tx.supplierCreditTransaction.create({
                    data: {
                        tenant_id: tenantId,
                        supplier_id: shipment.supplier_id,
                        type: 'CREDIT_PURCHASE',
                        amount: new Prisma.Decimal(sheet.goods_value_bdt),
                        balance_after: new Prisma.Decimal(balanceAfter),
                        reference_type: 'PURCHASE',
                        reference_id: purchase.id,
                        created_by: userId,
                    },
                });

                await tx.supplier.update({
                    where: { id: shipment.supplier_id },
                    data: { due_balance: new Prisma.Decimal(balanceAfter) },
                });
            }

            const inventoryAccountId = await this.accountIdByName(tx, tenantId, 'Purchases');
            const transitAccountId = await this.accountIdByName(tx, tenantId, ImportAccount.GOODS_IN_TRANSIT);
            const payableAccountId = await this.accountIdByName(tx, tenantId, 'Purchase Payable');

            const posting = await postMultiLeg({
                tx,
                tenantId,
                eventType: 'import_receipt',
                sourceModule: 'imports',
                sourceType: 'import_shipment',
                sourceId: shipment.id,
                storeId: shipment.store_id,
                description: `Import receipt ${shipment.reference_number}`,
                referenceNumber: shipment.reference_number,
                date: receivedAt,
                legs: [
                    { accountId: inventoryAccountId, debit: sheet.total_landed_bdt },
                    // Only the charges actually booked to transit are cleared;
                    // a zero here (nothing capitalised yet) drops the leg.
                    { accountId: transitAccountId, credit: sheet.capitalized_charges_bdt },
                    {
                        accountId: payableAccountId,
                        credit: sheet.goods_value_bdt,
                        ...(shipment.supplier_id
                            ? { partyType: 'SUPPLIER' as const, partyId: shipment.supplier_id }
                            : {}),
                    },
                ],
            });

            const updated = await tx.importShipment.update({
                where: { id },
                data: { status: ShipmentStatus.RECEIVED, purchase_id: purchase.id },
                include: { items: { include: { product: true } }, costs: true, supplier: true },
            });

            return {
                ...updated,
                purchase_number: purchase.purchase_number,
                cost_sheet: sheet,
                posting_status: posting.postingStatus,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    // ── Settlement (Phase 5) ─────────────────────────────────────────────────

    /**
     * Settles a usance LC and recognises the realised FX gain or loss.
     *
     * The liability was booked at `fx_rate_at_open`; the bank is paid at
     * whatever the rate is on the day. The difference is a realised gain or
     * loss — the only FX recognition this system does.
     *
     * Open positions are deliberately NOT revalued at period end. That would
     * mean a multi-currency GL, and no Bangladeshi importer needs one to run an
     * import business: they invoice their own customers in BDT. See the plan's
     * §4.6.
     *
     *     Dr LC Acceptance Payable   value at the opening rate
     *         Cr Bank                    value at the settlement rate
     *         Cr FX Gain                 the difference, if the taka strengthened
     *     — or Dr FX Loss                the difference, if it weakened
     */
    async settle(tenantId: string, id: string, dto: SettleShipmentDto) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);

        if (shipment.fx_rate_at_settle) {
            throw new BadRequestException('This shipment has already been settled.');
        }
        if (!shipment.purchase_id) {
            throw new BadRequestException('Receive the shipment before settling the LC.');
        }

        const openRate = shipment.currency === 'BDT' ? 1 : num(shipment.fx_rate_at_open);
        if (!openRate) {
            throw new BadRequestException('This shipment has no opening rate to settle against.');
        }

        const invoiceFc = num(shipment.invoice_value_fc);
        const bookedBdt = Math.round(invoiceFc * openRate * 100) / 100;
        const settledBdt = Math.round(invoiceFc * dto.fxRateAtSettle * 100) / 100;
        // Positive = the liability cost less than it was booked at, so a gain.
        const difference = Math.round((bookedBdt - settledBdt) * 100) / 100;
        const settledAt = dto.settledAt ? new Date(dto.settledAt) : new Date();

        return this.db.$transaction(async (tx) => {
            const payableAccountId = await this.accountIdByName(tx, tenantId, ImportAccount.LC_ACCEPTANCE_PAYABLE);

            const legs: Array<{ accountId: string; debit?: number; credit?: number }> = [
                { accountId: payableAccountId, debit: bookedBdt },
                { accountId: dto.paidFromAccountId, credit: settledBdt },
            ];

            if (difference > 0) {
                legs.push({ accountId: await this.accountIdByName(tx, tenantId, ImportAccount.FX_GAIN), credit: difference });
            } else if (difference < 0) {
                legs.push({ accountId: await this.accountIdByName(tx, tenantId, ImportAccount.FX_LOSS), debit: -difference });
            }
            // Exactly zero needs no third leg, and postMultiLeg would drop it.

            const posting = await postMultiLeg({
                tx,
                tenantId,
                eventType: 'import_settlement',
                sourceModule: 'imports',
                sourceType: 'import_shipment',
                sourceId: shipment.id,
                storeId: shipment.store_id,
                description: `LC settlement ${shipment.reference_number}`,
                referenceNumber: shipment.reference_number,
                date: settledAt,
                legs,
            });

            const updated = await tx.importShipment.update({
                where: { id },
                data: { fx_rate_at_settle: dto.fxRateAtSettle, status: ShipmentStatus.CLOSED },
            });

            return {
                ...updated,
                booked_bdt: bookedBdt,
                settled_bdt: settledBdt,
                fx_gain: difference > 0 ? difference : 0,
                fx_loss: difference < 0 ? -difference : 0,
                voucher_id: posting.voucherId ?? null,
                voucher_number: posting.voucherNumber ?? null,
            };
        });
    }

    // ── Reports (Phase 5) ────────────────────────────────────────────────────

    async costSheet(tenantId: string, id: string) {
        const shipment = await this.getShipmentOrThrow(tenantId, id);
        return {
            reference_number: shipment.reference_number,
            status: shipment.status,
            supplier: shipment.supplier?.name ?? null,
            lc_number: shipment.lc_number,
            ...this.buildCostSheet(shipment),
        };
    }

    /**
     * Open LCs and how close they are to expiring.
     *
     * An expired LC is a real loss — the bank's undertaking lapses and the
     * goods may already be on the water — and nothing else in the system
     * watches a date. `days_to_expiry` goes negative rather than clamping,
     * because "expired eleven days ago" is the row that needs acting on.
     */
    async lcRegister(tenantId: string, withinDays?: number) {
        const shipments = await this.db.importShipment.findMany({
            where: {
                tenant_id: tenantId,
                lc_number: { not: null },
                status: { notIn: [ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED] },
                ...(withinDays
                    ? {
                          lc_expiry_date: {
                              lte: new Date(Date.now() + withinDays * 24 * 60 * 60 * 1000),
                          },
                      }
                    : {}),
            },
            include: {
                supplier: { select: { name: true } },
                costs: { select: { amount_bdt: true } },
            },
            // Nulls last so a shipment with no expiry recorded does not head
            // the list a user is reading for urgency.
            orderBy: [{ lc_expiry_date: { sort: 'asc', nulls: 'last' } }],
        });

        const today = new Date();

        return shipments.map((shipment) => {
            const expiry = shipment.lc_expiry_date;
            const daysToExpiry = expiry
                ? Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000))
                : null;

            return {
                id: shipment.id,
                reference_number: shipment.reference_number,
                lc_number: shipment.lc_number,
                lc_type: shipment.lc_type,
                bank_name: shipment.bank_name,
                supplier: shipment.supplier?.name ?? null,
                status: shipment.status,
                currency: shipment.currency,
                invoice_value_fc: num(shipment.invoice_value_fc),
                invoice_value_bdt:
                    Math.round(num(shipment.invoice_value_fc) * num(shipment.fx_rate_at_open) * 100) / 100,
                lc_date: shipment.lc_date,
                lc_expiry_date: expiry,
                latest_shipment_date: shipment.latest_shipment_date,
                days_to_expiry: daysToExpiry,
                is_expired: daysToExpiry !== null && daysToExpiry < 0,
                costs_to_date_bdt:
                    Math.round(shipment.costs.reduce((sum, cost) => sum + num(cost.amount_bdt), 0) * 100) / 100,
            };
        });
    }

    /**
     * Duty, VAT, AIT and the rest, by type, over a period — the figures a VAT
     * return needs. Dated on `paid_at` rather than `created_at`, because the
     * return reports what was paid in the period, not what was typed in.
     */
    async dutyReport(tenantId: string, range: { from?: string; to?: string }) {
        const costs = await this.db.importCost.findMany({
            where: {
                tenant_id: tenantId,
                cost_type: { in: ['CUSTOMS_DUTY', 'VAT', 'AIT', 'RD', 'SD'] },
                ...(range.from || range.to
                    ? {
                          paid_at: {
                              ...(range.from ? { gte: new Date(range.from) } : {}),
                              ...(range.to ? { lte: new Date(range.to) } : {}),
                          },
                      }
                    : { paid_at: { not: null } }),
            },
            include: {
                shipment: { select: { reference_number: true, be_number: true, be_date: true } },
            },
            orderBy: { paid_at: 'asc' },
        });

        const byType = new Map<string, number>();
        for (const cost of costs) {
            byType.set(cost.cost_type, (byType.get(cost.cost_type) ?? 0) + num(cost.amount_bdt));
        }

        const recoverable = costs
            .filter((cost) => !cost.is_capitalized)
            .reduce((sum, cost) => sum + num(cost.amount_bdt), 0);

        return {
            totals_by_type: [...byType.entries()].map(([cost_type, amount_bdt]) => ({
                cost_type,
                amount_bdt: Math.round(amount_bdt * 100) / 100,
            })),
            total_bdt: Math.round([...byType.values()].reduce((sum, value) => sum + value, 0) * 100) / 100,
            /** VAT and AIT — claimable back, so not a cost of the goods. */
            recoverable_bdt: Math.round(recoverable * 100) / 100,
            lines: costs.map((cost) => ({
                shipment_reference: cost.shipment.reference_number,
                be_number: cost.shipment.be_number,
                be_date: cost.shipment.be_date,
                cost_type: cost.cost_type,
                amount_bdt: num(cost.amount_bdt),
                is_recoverable: !cost.is_capitalized,
                paid_at: cost.paid_at,
            })),
        };
    }

    /**
     * How much LC exposure is outstanding with each bank.
     *
     * A bank grants an importer an LC limit, and exceeding it means the next
     * application is refused — usually discovered at the counter. Outstanding
     * is measured at the opening rate, which is what the bank's own exposure is
     * booked at.
     */
    async bankLimitUtilisation(tenantId: string) {
        const shipments = await this.db.importShipment.findMany({
            where: {
                tenant_id: tenantId,
                bank_name: { not: null },
                status: { notIn: [ShipmentStatus.CLOSED, ShipmentStatus.CANCELLED, ShipmentStatus.DRAFT] },
            },
            select: {
                bank_name: true,
                currency: true,
                invoice_value_fc: true,
                fx_rate_at_open: true,
                status: true,
            },
        });

        const byBank = new Map<string, { outstanding_bdt: number; open_lcs: number }>();

        for (const shipment of shipments) {
            const bank = shipment.bank_name!;
            const rate = shipment.currency === 'BDT' ? 1 : num(shipment.fx_rate_at_open);
            const entry = byBank.get(bank) ?? { outstanding_bdt: 0, open_lcs: 0 };
            entry.outstanding_bdt += num(shipment.invoice_value_fc) * rate;
            entry.open_lcs += 1;
            byBank.set(bank, entry);
        }

        return [...byBank.entries()]
            .map(([bank_name, entry]) => ({
                bank_name,
                open_lcs: entry.open_lcs,
                outstanding_bdt: Math.round(entry.outstanding_bdt * 100) / 100,
            }))
            .sort((a, b) => b.outstanding_bdt - a.outstanding_bdt);
    }
}

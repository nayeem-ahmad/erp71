import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { autoPostFromRules, voidAutoPostedVoucher } from '../accounting/posting.utils';
import { cashLegOverride, resolveCreditPaymentMethod, storedPaymentMethodAccountId } from '../accounting/payment-account.util';
import { buildPartyLedger } from '../accounting/party-ledger.util';
import { DatabaseService } from '../database/database.service';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { paginate } from '../common/pagination.dto';
import { resolveOrderBy, SortableMap } from '../common/sort.util';
import { createdAtRange } from '../common/created-range.util';
import {
    AllocateSupplierPaymentDto,
    CreateSupplierDto,
    ListSupplierCreditPaymentsQueryDto,
    PaymentAllocationInputDto,
    RecordSupplierCreditPaymentDto,
    SupplierPaymentDirectionDto,
    UpdateSupplierCreditPaymentDto,
    UpdateSupplierDto,
} from './supplier.dto';
import { runImport, ImportResult } from '../common/import.util';
import { nextSupplierPaymentNumber, SUPPLIER_PAYMENT_PREFIXES } from './supplier-payment-number.util';
import {
    assertNotAheadOfSeries,
    assertSerialFree,
    canonicalSerial,
    isSerialConflict,
    resolvePaymentDate,
    serialTaken,
    typedSerial,
} from '../common/credit-payment-entry.util';
import { ACTIVE_PURCHASE, purchasePaymentStatus } from '../purchases/purchase-status';
import { SupplierScope, supplierRowScopeWhere, supplierScopeWhere } from './supplier-visibility';
import { makeImportBranchResolver } from '../common/import-branch.util';
import { codeForNewRecord, nextSeriesCode } from '../common/code-series.util';

/** The numbered series a typed payment serial may fall in (payments, payouts). */
const SERIAL_SERIES = Object.values(SUPPLIER_PAYMENT_PREFIXES);

const SUPPLIER_SORTABLE: SortableMap = {
    name: (dir) => ({ name: dir }),
    supplier_code: (dir) => ({ supplier_code: dir }),
    phone: (dir) => ({ phone: dir }),
    email: (dir) => ({ email: dir }),
    due_balance: (dir) => ({ due_balance: dir }),
    created_at: (dir) => ({ created_at: dir }),
};
const SUPPLIER_DEFAULT_ORDER = { name: 'asc' as const };

/** Amounts below this are rounding dust, not money. */
const AMOUNT_EPSILON = 0.005;

/**
 * The legKey of a payment's discount voucher. The cash voucher stays keyless,
 * so payments recorded before discounts existed keep their idempotency keys.
 */
const DISCOUNT_LEG = 'discount';

@Injectable()
export class SuppliersService {
    constructor(private db: DatabaseService) {}

    /**
     * The supplier belongs to `dto.store_id`, or to `opts.storeId` — the
     * header branch — when the form names none: a branch of this tenant the
     * caller may use (`opts.scope`; null is every branch).
     */
    async create(tenantId: string, dto: CreateSupplierDto, opts: { storeId?: string; scope?: SupplierScope } = {}) {
        // `@IsString()` accepts "" and "   ", either of which would reach the
        // picker as a blank row nobody can pick out of a list.
        const name = dto.name.trim();
        if (!name) {
            throw new BadRequestException('A name is required to create a supplier.');
        }

        const existing = await this.db.supplier.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name } },
            select: { id: true, deleted_at: true, supplier_code: true },
        });

        if (existing && !existing.deleted_at) {
            throw new BadRequestException('A supplier with this name already exists.');
        }

        const typedCode = dto.supplier_code?.trim() || null;
        if (typedCode) await this.assertCodeFree(tenantId, typedCode, existing?.id);

        const storeId = await this.branchForNewSupplier(tenantId, dto.store_id ?? opts.storeId, opts.scope ?? null);
        const details = { phone: dto.phone, email: dto.email, address: dto.address, store_id: storeId };

        // `@@unique([tenant_id, name])` spans soft-deleted rows, so a deleted
        // supplier goes on holding its name. Refusing here would reject the name
        // on behalf of a supplier no list shows — the shopkeeper is told it is
        // taken and can never find what took it. Bring that row back instead:
        // its purchases, payable and ledger are still the same supplier's.
        if (existing) {
            const supplierCode = typedCode ?? existing.supplier_code ?? (await nextSeriesCode(this.db, 'Supplier', tenantId));
            return this.db.supplier.update({
                where: { id: existing.id },
                data: { deleted_at: null, name, supplier_code: supplierCode, ...details },
            });
        }

        if (typedCode) {
            return this.db.supplier.create({
                data: { tenant_id: tenantId, name, supplier_code: typedCode, ...details },
            });
        }
        // Left blank: the next SUP-##### code.
        return codeForNewRecord(this.db, 'Supplier', tenantId, null, (supplierCode) =>
            this.db.supplier.create({
                data: { tenant_id: tenantId, name, supplier_code: supplierCode, ...details },
            }),
        );
    }

    /** A file's code must not be another supplier's; the supplier the row names may hold it already. */
    private async assertImportCodeFree(tenantId: string, code: string, name: string) {
        const holder = await this.db.supplier.findFirst({
            where: { tenant_id: tenantId, supplier_code: code },
            select: { name: true },
        });
        if (holder && holder.name !== name) {
            throw new BadRequestException(`supplier code "${code}" is already ${holder.name}'s`);
        }
    }

    /** A typed code must not be another supplier's, deleted ones included: the unique index spans them. */
    private async assertCodeFree(tenantId: string, code: string, ownId?: string) {
        const holder = await this.db.supplier.findFirst({
            where: { tenant_id: tenantId, supplier_code: code },
            select: { id: true },
        });
        if (holder && holder.id !== ownId) {
            throw new BadRequestException(`Supplier code "${code}" is already in use.`);
        }
    }

    /** A branch of this tenant, and — for a member limited to some branches — one of theirs. */
    private async branchForNewSupplier(tenantId: string, storeId: string | null | undefined, scope: SupplierScope) {
        if (!storeId) throw new BadRequestException('Choose the branch this supplier belongs to.');
        await this.checkedStoreId(tenantId, storeId);
        if (scope && !scope.includes(storeId)) {
            throw new ForbiddenException('You can only add suppliers to your own branches.');
        }
        return storeId;
    }

    private async checkedStoreId(tenantId: string, storeId: string) {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId }, select: { id: true } });
        if (!store) throw new BadRequestException('Branch not found.');
        return storeId;
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 100,
        opts?: { search?: string; sortBy?: string; sortDir?: string; scope?: SupplierScope },
    ): Promise<PaginatedResult<unknown>> {
        const where: any = { tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(opts?.scope ?? null) };
        if (opts?.search) {
            where.OR = [
                { name: { contains: opts.search, mode: 'insensitive' } },
                { supplier_code: { contains: opts.search, mode: 'insensitive' } },
                { phone: { contains: opts.search } },
                { email: { contains: opts.search, mode: 'insensitive' } },
                { address: { contains: opts.search, mode: 'insensitive' } },
            ];
        }

        return paginatedFindMany({
            findMany: (args) => this.db.supplier.findMany(args as any),
            count: (args) => this.db.supplier.count(args as any),
            where,
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, SUPPLIER_SORTABLE, SUPPLIER_DEFAULT_ORDER),
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string, scope: SupplierScope = null) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        return supplier;
    }

    /**
     * `opts.canSetBranch` false (a member who does not see every branch) refuses
     * a move to another branch; moving takes the supplier's payable with it and
     * leaves their past credit rows where they were.
     */
    async update(
        tenantId: string,
        id: string,
        dto: UpdateSupplierDto,
        opts: { scope?: SupplierScope; canSetBranch?: boolean } = {},
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(opts.scope ?? null) },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        const name = dto.name === undefined ? undefined : dto.name.trim();
        if (name === '') {
            throw new BadRequestException('A name is required to create a supplier.');
        }

        if (name && name !== supplier.name) {
            const duplicate = await this.db.supplier.findUnique({
                where: { tenant_id_name: { tenant_id: tenantId, name } },
                select: { id: true, deleted_at: true },
            });
            // A deleted supplier still holds its name (see `create`). Two rows
            // cannot share one, and merging this supplier's history into that
            // one is not a rename, so say which it is: creating the name brings
            // the deleted supplier back, which is what the shopkeeper wants.
            if (duplicate && duplicate.id !== id) {
                throw new BadRequestException(duplicate.deleted_at
                    ? 'A deleted supplier still holds this name. Add a supplier with that name to bring it back.'
                    : 'A supplier with this name already exists.');
            }
        }

        if (dto.store_id !== undefined && dto.store_id !== supplier.store_id) {
            if (opts.canSetBranch === false) {
                throw new ForbiddenException('Only an owner can move a supplier to another branch.');
            }
            await this.checkedStoreId(tenantId, dto.store_id);
        }

        // Blank keeps the code it has: every supplier carries one.
        const code = dto.supplier_code?.trim() || undefined;
        if (code && code !== supplier.supplier_code) await this.assertCodeFree(tenantId, code, id);

        return this.db.supplier.update({
            where: { id },
            data: {
                ...(name !== undefined ? { name } : {}),
                ...(code !== undefined ? { supplier_code: code } : {}),
                ...(dto.store_id !== undefined ? { store_id: dto.store_id } : {}),
                ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
                ...(dto.email !== undefined ? { email: dto.email } : {}),
                ...(dto.address !== undefined ? { address: dto.address } : {}),
            },
        });
    }

    async remove(tenantId: string, id: string, scope: SupplierScope = null) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        await this.db.supplier.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        return { success: true };
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
        /** The branch rows without their own go to: the one picked for the file, else the header branch. */
        storeId?: string,
        /** An upsert may not overwrite a supplier outside the importer's scope, nor add one to a branch outside it. */
        scope: SupplierScope = null,
    ): Promise<ImportResult> {
        const branchOf = await makeImportBranchResolver(this.db, tenantId, scope);
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                supplier_code: raw.supplier_code ? String(raw.supplier_code).trim() || null : null,
                phone: raw.phone ? String(raw.phone).trim() || null : null,
                email: raw.email ? String(raw.email).trim() || null : null,
                address: raw.address ? String(raw.address).trim() || null : null,
                branch: raw.branch ? String(raw.branch).trim() || null : null,
            }),
            findDuplicate: async (row) => {
                const existing = await this.db.supplier.findUnique({
                    where: { tenant_id_name: { tenant_id: tenantId, name: row.name } },
                    select: { id: true, deleted_at: true },
                });
                // A deleted supplier is not a row to skip over or quietly update
                // in place: either way the import reports a supplier the lists
                // never show. `create` below revives it instead.
                return existing && !existing.deleted_at ? existing.id : null;
            },
            create: async (row) => {
                const rowStoreId = branchOf(row.branch) ?? storeId;
                if (!rowStoreId) throw new BadRequestException('no branch — pick one for the file or fill the branch column');
                // Upsert rather than insert: the name may still be held by a
                // deleted supplier, whom the file is asking for back — on the
                // branch the file puts them, keeping their code unless the file
                // gives another.
                const details = { phone: row.phone, email: row.email, address: row.address, store_id: rowStoreId };
                const upsert = (supplierCode: string) => this.db.supplier.upsert({
                    where: { tenant_id_name: { tenant_id: tenantId, name: row.name } },
                    create: { tenant_id: tenantId, name: row.name, supplier_code: supplierCode, ...details },
                    update: { deleted_at: null, ...(row.supplier_code ? { supplier_code: supplierCode } : {}), ...details },
                });
                if (row.supplier_code) {
                    await this.assertImportCodeFree(tenantId, row.supplier_code, row.name);
                    await upsert(row.supplier_code);
                } else {
                    await codeForNewRecord(this.db, 'Supplier', tenantId, null, upsert);
                }
            },
            update: async (id, row) => {
                if (scope && !(await this.db.supplier.count({ where: { id, ...supplierScopeWhere(scope) } }))) {
                    throw new BadRequestException('matches a supplier of another branch — not updated');
                }
                if (row.supplier_code) await this.assertImportCodeFree(tenantId, row.supplier_code, row.name);
                await this.db.supplier.update({
                    where: { id },
                    data: {
                        name: row.name,
                        ...(row.supplier_code ? { supplier_code: row.supplier_code } : {}),
                        phone: row.phone,
                        email: row.email,
                        address: row.address,
                    },
                });
            },
        });
    }

    private dueDelta(type: 'PAYMENT' | 'PAYOUT', amount: number, discount = 0): number {
        return this.ledgerDueDelta(type, amount, discount);
    }

    /**
     * A PAYMENT settles its discount along with its money, so the due falls by
     * both. Only a payment carries a discount; it is ignored for other types.
     */
    private ledgerDueDelta(type: string, amount: number, discount = 0): number {
        switch (type) {
            case 'CREDIT_PURCHASE':
            case 'PAYOUT':
                return amount;
            case 'PAYMENT':
                return -(amount + discount);
            case 'ADJUSTMENT':
                return amount;
            default:
                return 0;
        }
    }

    /** What a payment settles: its money plus any discount taken with it. */
    private settledBy(payment: { amount: unknown; discount_amount?: unknown }): number {
        return Number(payment.amount) + Number(payment.discount_amount ?? 0);
    }

    /**
     * A discount is only taken on money paid to the supplier, and never beyond
     * what the payment leaves due — anything more would be the supplier owing
     * the shop, booked as income.
     */
    private assertPaymentSplit(type: 'PAYMENT' | 'PAYOUT', amount: number, discount: number, dueBefore: number) {
        if (amount < 0 || discount < 0) throw new BadRequestException('Amount and discount cannot be negative');
        if (type === 'PAYOUT') {
            if (discount > AMOUNT_EPSILON) {
                throw new BadRequestException('A discount can only be taken on a payment made to the supplier.');
            }
            if (amount < AMOUNT_EPSILON) throw new BadRequestException('Amount must be positive');
            return;
        }
        if (amount + discount < AMOUNT_EPSILON) {
            throw new BadRequestException('Enter an amount paid, a discount, or both.');
        }
        const leftAfterPayment = Math.max(0, dueBefore - amount);
        if (discount - leftAfterPayment > AMOUNT_EPSILON) {
            throw new BadRequestException(
                `Discount of ৳${discount.toFixed(2)} is more than the ৳${leftAfterPayment.toFixed(2)} still due after this payment.`,
            );
        }
    }

    /**
     * Posts a payment's vouchers: the money on the keyless cash leg (Dr/Cr
     * Purchase Payable against cash), the discount as its own JOURNAL voucher
     * (Dr Purchase Payable / Cr Discount Received) on legKey 'discount'. Both
     * dated at the payment, so an edit reposts into the period it belongs to.
     */
    private async postPaymentLegs(
        tx: any,
        input: {
            tenantId: string;
            supplierId: string;
            supplierName: string;
            paymentId: string;
            paymentNumber: string;
            type: 'PAYMENT' | 'PAYOUT';
            amount: number;
            discount: number;
            date: Date;
            /** The payment method's ledger account; the rule's Cash in Hand when unset. */
            cashAccountId?: string;
            /** The payment's branch — its supplier's — so a branch's payable clears against its purchases. */
            storeId: string;
        },
    ) {
        const common = {
            tx,
            tenantId: input.tenantId,
            storeId: input.storeId,
            eventType: 'supplier_payment' as const,
            conditionKey: 'payment_direction' as const,
            sourceModule: 'suppliers',
            sourceId: input.paymentId,
            referenceNumber: input.paymentNumber,
            date: input.date,
            partyType: 'SUPPLIER' as const,
            partyId: input.supplierId,
        };

        // Purchases credit Purchase Payable; without this nothing ever debits
        // it, so the payable grows forever and the balance sheet overstates
        // liabilities. PAYMENT (we pay the supplier) reduces the payable;
        // PAYOUT (we receive from the supplier) increases it — mirroring
        // dueDelta above, so the voucher and due_balance cannot disagree.
        const cash = input.amount > AMOUNT_EPSILON
            ? await autoPostFromRules({
                ...common,
                conditionValue: input.type === 'PAYMENT' ? 'pay' : 'receive',
                sourceType: 'supplier_payment',
                amount: input.amount,
                ...cashLegOverride(input.type === 'PAYMENT' ? 'out' : 'in', input.cashAccountId),
                description: `Auto-posted supplier ${input.type === 'PAYMENT' ? 'payment' : 'receipt'} — ${input.supplierName}`,
            })
            : null;

        const discount = input.discount > AMOUNT_EPSILON
            ? await autoPostFromRules({
                ...common,
                conditionValue: 'discount',
                legKey: DISCOUNT_LEG,
                sourceType: 'supplier_payment_discount',
                amount: input.discount,
                description: `Discount received — ${input.supplierName}`,
            })
            : null;

        const primary = cash ?? discount;
        return {
            posting_status: primary?.postingStatus ?? 'skipped',
            voucher_id: primary?.voucherId ?? null,
            voucher_number: primary?.voucherNumber ?? null,
            discount_voucher_id: discount?.voucherId ?? null,
            discount_voucher_number: discount?.voucherNumber ?? null,
        };
    }

    /** Takes back both of a payment's vouchers. Either may be absent. */
    private async voidPaymentLegs(tx: any, tenantId: string, paymentId: string) {
        await voidAutoPostedVoucher(tx, tenantId, 'supplier_payment', paymentId);
        await voidAutoPostedVoucher(tx, tenantId, 'supplier_payment', paymentId, DISCOUNT_LEG);
    }

    private paymentStatusFor(paidAmount: number, totalAmount: number): string {
        return purchasePaymentStatus(paidAmount, totalAmount);
    }

    /** Validates and applies a set of allocations against open bills for one supplier, inside an existing transaction. */
    private async applyAllocations(
        tx: any,
        tenantId: string,
        supplierId: string,
        transactionId: string,
        allocations: PaymentAllocationInputDto[],
        remainingOnTransaction: number,
    ) {
        const requestedTotal = allocations.reduce((sum, a) => sum + a.amount, 0);
        if (requestedTotal - remainingOnTransaction > 0.005) {
            throw new BadRequestException(
                `Allocation total (${requestedTotal.toFixed(2)}) exceeds the unapplied amount on this payment (${remainingOnTransaction.toFixed(2)}).`,
            );
        }

        const purchaseIds = allocations.map((a) => a.purchaseId);
        // A cancelled bill is not payable, so it must not be findable here:
        // the loop below reports an unmatched id as "does not belong to this
        // supplier", which is the right refusal for an allocation against one.
        const purchases = await tx.purchase.findMany({
            where: { id: { in: purchaseIds }, tenant_id: tenantId, supplier_id: supplierId, ...ACTIVE_PURCHASE },
            select: { id: true, total_amount: true, paid_amount: true, purchase_number: true },
        });
        const purchaseById = new Map<string, any>(purchases.map((p: any) => [p.id, p]));

        for (const allocation of allocations) {
            const purchase = purchaseById.get(allocation.purchaseId);
            if (!purchase) {
                throw new BadRequestException('One or more bills do not belong to this supplier.');
            }
            const balanceDue = Number(purchase.total_amount) - Number(purchase.paid_amount);
            if (allocation.amount - balanceDue > 0.005) {
                throw new BadRequestException(
                    `Allocation of ${allocation.amount.toFixed(2)} exceeds the balance due (${balanceDue.toFixed(2)}) on bill ${purchase.purchase_number}.`,
                );
            }
        }

        for (const allocation of allocations) {
            const purchase = purchaseById.get(allocation.purchaseId);
            const newPaidAmount = Number(purchase.paid_amount) + allocation.amount;

            await tx.supplierPaymentAllocation.create({
                data: {
                    tenant_id: tenantId,
                    transaction_id: transactionId,
                    purchase_id: allocation.purchaseId,
                    amount: allocation.amount,
                },
            });

            await tx.purchase.update({
                where: { id: allocation.purchaseId },
                data: {
                    paid_amount: newPaidAmount,
                    payment_status: this.paymentStatusFor(newPaidAmount, Number(purchase.total_amount)),
                },
            });
        }
    }

    private directionFromType(type: string): SupplierPaymentDirectionDto {
        return type === 'PAYOUT' ? SupplierPaymentDirectionDto.RECEIVE : SupplierPaymentDirectionDto.PAY;
    }

    private typeFromDirection(direction: SupplierPaymentDirectionDto): 'PAYMENT' | 'PAYOUT' {
        return direction === SupplierPaymentDirectionDto.PAY ? 'PAYMENT' : 'PAYOUT';
    }

    private async findCreditPaymentOrThrow(tenantId: string, paymentId: string, scope: SupplierScope = null) {
        const payment = await this.db.supplierCreditTransaction.findFirst({
            where: {
                id: paymentId,
                tenant_id: tenantId,
                type: { in: ['PAYMENT', 'PAYOUT'] },
                ...supplierRowScopeWhere(scope),
            },
            include: {
                supplier: { select: { id: true, name: true, phone: true, due_balance: true } },
                creator: { select: { id: true, name: true } },
            },
        });
        if (!payment) throw new NotFoundException('Supplier payment not found');
        return payment;
    }

    async getCreditLedger(
        tenantId: string,
        id: string,
        params?: { page?: number; limit?: number; from?: string; to?: string },
        scope: SupplierScope = null,
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
            select: { id: true, name: true, phone: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const page = params?.page ?? 1;
        const limit = Math.min(params?.limit ?? 100, 500);
        const skip = (page - 1) * limit;

        const where: any = { supplier_id: id, tenant_id: tenantId };
        let periodStart: Date | null = null;

        if (params?.from || params?.to) {
            where.created_at = {};
            if (params.from) {
                periodStart = new Date(params.from);
                periodStart.setUTCHours(0, 0, 0, 0);
                where.created_at.gte = periodStart;
            }
            if (params.to) {
                const to = new Date(params.to);
                to.setUTCHours(23, 59, 59, 999);
                where.created_at.lte = to;
            }
        }

        let opening_balance = 0;
        if (periodStart) {
            const priorTx = await this.db.supplierCreditTransaction.findFirst({
                where: {
                    supplier_id: id,
                    tenant_id: tenantId,
                    created_at: { lt: periodStart },
                },
                orderBy: { created_at: 'desc' },
                select: { balance_after: true },
            });
            opening_balance = priorTx ? Number(priorTx.balance_after) : 0;
        }

        const [total, transactions] = await Promise.all([
            this.db.supplierCreditTransaction.count({ where }),
            this.db.supplierCreditTransaction.findMany({
                where,
                orderBy: { created_at: 'asc' },
                skip,
                take: limit,
                include: { creator: { select: { id: true, name: true } } },
            }),
        ]);

        const purchaseIds = transactions
            .filter((tx) => tx.type === 'CREDIT_PURCHASE' && tx.reference_type === 'PURCHASE' && tx.reference_id)
            .map((tx) => tx.reference_id as string);
        const paymentTransactionIds = transactions.filter((tx) => tx.type === 'PAYMENT').map((tx) => tx.id);

        const [bills, allocations] = await Promise.all([
            purchaseIds.length > 0
                ? this.db.purchase.findMany({
                      where: { id: { in: purchaseIds }, tenant_id: tenantId },
                      select: { id: true, payment_status: true, paid_amount: true, total_amount: true },
                  })
                : Promise.resolve([]),
            paymentTransactionIds.length > 0
                ? this.db.supplierPaymentAllocation.findMany({
                      where: { tenant_id: tenantId, transaction_id: { in: paymentTransactionIds } },
                      select: {
                          transaction_id: true,
                          amount: true,
                          purchase: { select: { id: true, purchase_number: true } },
                      },
                  })
                : Promise.resolve([]),
        ]);

        const billById = new Map(bills.map((b: any) => [b.id, b]));
        const allocationsByTransaction = new Map<string, any[]>();
        for (const allocation of allocations) {
            const list = allocationsByTransaction.get(allocation.transaction_id) ?? [];
            list.push({
                purchaseId: allocation.purchase.id,
                purchaseNumber: allocation.purchase.purchase_number,
                amount: Number(allocation.amount),
            });
            allocationsByTransaction.set(allocation.transaction_id, list);
        }

        const items = transactions.map((tx) => {
            const amount = Number(tx.amount);
            const balanceAfter = Number(tx.balance_after);
            const base = {
                ...tx,
                amount,
                balance_after: balanceAfter,
                discount_amount: Number(tx.discount_amount ?? 0),
                balance_before: balanceAfter - this.ledgerDueDelta(tx.type, amount, Number(tx.discount_amount ?? 0)),
            };

            if (tx.type === 'CREDIT_PURCHASE' && tx.reference_type === 'PURCHASE' && tx.reference_id) {
                const bill = billById.get(tx.reference_id);
                if (bill) {
                    return {
                        ...base,
                        bill: {
                            payment_status: bill.payment_status,
                            paid_amount: Number(bill.paid_amount),
                            total_amount: Number(bill.total_amount),
                            balance_due: Number(bill.total_amount) - Number(bill.paid_amount),
                        },
                    };
                }
            }

            if (tx.type === 'PAYMENT') {
                const txAllocations = allocationsByTransaction.get(tx.id) ?? [];
                const allocatedTotal = txAllocations.reduce((sum, a) => sum + a.amount, 0);
                return {
                    ...base,
                    allocations: txAllocations,
                    unapplied_amount: this.settledBy(tx) - allocatedTotal,
                };
            }

            return base;
        });

        const closing_balance = items.length > 0
            ? Number(items[items.length - 1].balance_after)
            : opening_balance;

        const pages = Math.ceil(total / limit);
        return {
            supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
            due_balance: Number(supplier.due_balance),
            opening_balance,
            closing_balance,
            transactions: items,
            total,
            page,
            limit,
            pages,
        };
    }

    /**
     * The supplier ledger derived from the GENERAL LEDGER — the Purchase Payable
     * voucher lines tagged to this supplier — rather than from
     * SupplierCreditTransaction. Same shape as getCreditLedger so the UI can swap
     * to it; kept alongside so the two can be diffed before the parallel table is
     * retired.
     */
    async getGlLedger(tenantId: string, id: string, params?: { from?: string; to?: string }, scope: SupplierScope = null) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
            select: { id: true, name: true, phone: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const ledger = await buildPartyLedger(this.db, tenantId, 'SUPPLIER', id, {
            from: params?.from,
            to: params?.to,
            increaseLabel: 'CREDIT_PURCHASE',
            decreaseLabel: 'PAYMENT',
        });

        return {
            supplier: { id: supplier.id, name: supplier.name, phone: supplier.phone },
            due_balance: Number(supplier.due_balance),
            opening_balance: ledger.opening_balance,
            closing_balance: ledger.closing_balance,
            transactions: ledger.transactions,
            total: ledger.total,
            source: 'general_ledger' as const,
        };
    }

    /**
     * `query.branch` is the branch the page shows, already checked by the
     * controller (undefined: every branch the scope allows); `query.scope` the
     * suppliers the caller may see at all.
     */
    async listCreditPayments(
        tenantId: string,
        query: Omit<ListSupplierCreditPaymentsQueryDto, 'storeId'> & { timezone: string; branch?: string; scope?: SupplierScope },
    ): Promise<PaginatedResult<any>> {
        const page = query.page ?? 1;
        const limit = Math.min(query.limit ?? 20, 100);
        const skip = (page - 1) * limit;

        const where: any = {
            tenant_id: tenantId,
            type: { in: ['PAYMENT', 'PAYOUT'] },
            ...supplierRowScopeWhere(query.scope ?? null),
            ...(query.branch ? { store_id: query.branch } : {}),
        };

        if (query.supplierId) {
            where.supplier_id = query.supplierId;
        }

        const created = createdAtRange(query.from, query.to, query.timezone);
        if (created) where.created_at = created;

        if (query.search) {
            where.OR = [
                { payment_number: { contains: query.search, mode: 'insensitive' } },
                { notes: { contains: query.search, mode: 'insensitive' } },
                { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
                { supplier: { phone: { contains: query.search } } },
            ];
        }

        const [items, total] = await Promise.all([
            this.db.supplierCreditTransaction.findMany({
                where,
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
                orderBy: { created_at: 'desc' },
                skip,
                take: limit,
            }),
            this.db.supplierCreditTransaction.count({ where }),
        ]);

        const paymentIds = items.filter((i) => i.type === 'PAYMENT').map((i) => i.id);
        const allocatedByTransaction = new Map<string, number>();
        if (paymentIds.length > 0) {
            const grouped = await this.db.supplierPaymentAllocation.groupBy({
                by: ['transaction_id'],
                where: { tenant_id: tenantId, transaction_id: { in: paymentIds } },
                _sum: { amount: true },
            });
            for (const g of grouped) {
                allocatedByTransaction.set(g.transaction_id, Number(g._sum.amount ?? 0));
            }
        }

        const itemsWithAllocation = items.map((item) => {
            if (item.type !== 'PAYMENT') return item;
            const allocated = allocatedByTransaction.get(item.id) ?? 0;
            return {
                ...item,
                allocated_amount: allocated,
                unapplied_amount: this.settledBy(item) - allocated,
            };
        });

        return paginate(itemsWithAllocation, total, page, limit);
    }

    async getCreditPayment(tenantId: string, paymentId: string, scope: SupplierScope = null) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        if (payment.type !== 'PAYMENT') return payment;

        const allocatedSum = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: paymentId },
            _sum: { amount: true },
        });
        const allocated = Number(allocatedSum._sum.amount ?? 0);
        return { ...payment, allocated_amount: allocated, unapplied_amount: this.settledBy(payment) - allocated };
    }

    /**
     * The serial a new payment would get if saved now, for the entry form to
     * show. Not reserved: a form left blank is numbered at save time, so two
     * operators previewing at once cannot collide.
     */
    async getNextPaymentNumber(tenantId: string, direction?: SupplierPaymentDirectionDto) {
        const txType = this.typeFromDirection(direction ?? SupplierPaymentDirectionDto.PAY);
        return { payment_number: await nextSupplierPaymentNumber(tenantId, this.db, txType) };
    }

    async updateCreditPayment(
        tenantId: string,
        paymentId: string,
        dto: UpdateSupplierCreditPaymentDto,
        timeZone?: string,
        scope: SupplierScope = null,
    ) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const oldDiscount = Number(payment.discount_amount ?? 0);
        const supplierId = payment.supplier_id;

        const newDirection = dto.direction ?? this.directionFromType(oldType);
        const newType = this.typeFromDirection(newDirection);
        const newAmount = dto.amount ?? oldAmount;
        const newDiscount = dto.discount ?? oldDiscount;
        const newNotes = dto.notes !== undefined ? dto.notes : payment.notes;
        const newDate = resolvePaymentDate(dto.date, timeZone) ?? payment.created_at;
        const typedRename = typedSerial(dto.paymentNumber);
        const renamedTo = typedRename && canonicalSerial(typedRename, SERIAL_SERIES);
        const newNumber = renamedTo && renamedTo !== payment.payment_number ? renamedTo : payment.payment_number;
        const newMethod = dto.paymentMethodId
            ? await resolveCreditPaymentMethod(this.db, tenantId, dto.paymentMethodId)
            : null;

        const allocatedSum = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: paymentId },
            _sum: { amount: true },
        });
        const allocatedTotal = Number(allocatedSum._sum.amount ?? 0);
        if (allocatedTotal > AMOUNT_EPSILON) {
            if (newType !== 'PAYMENT') {
                throw new BadRequestException('Remove this payment\'s bill allocations before changing its direction.');
            }
            if (newAmount + newDiscount - allocatedTotal < -AMOUNT_EPSILON) {
                throw new BadRequestException(
                    `Cannot reduce this payment below its already-allocated amount (${allocatedTotal.toFixed(2)}). Remove allocations first.`,
                );
            }
        }

        return this.db.$transaction(async (tx) => {
            const supplier = await tx.supplier.findFirst({
                where: { id: supplierId, tenant_id: tenantId, deleted_at: null },
                select: { id: true, name: true, due_balance: true },
            });
            if (!supplier) throw new NotFoundException('Supplier not found');
            if (newNumber && newNumber !== payment.payment_number) {
                await assertSerialFree(tx, 'supplierCreditTransaction', tenantId, newNumber, paymentId);
                await assertNotAheadOfSeries(tx, 'SupplierCreditTransaction', tenantId, newNumber, SERIAL_SERIES);
            }

            const dueWithoutPayment = Number(supplier.due_balance) - this.dueDelta(oldType, oldAmount, oldDiscount);
            this.assertPaymentSplit(newType, newAmount, newDiscount, dueWithoutPayment);
            const balanceAfter = dueWithoutPayment + this.dueDelta(newType, newAmount, newDiscount);

            // The old vouchers must go: the GL is the supplier ledger, so an edit
            // that left them behind would show the original payment forever.
            await this.voidPaymentLegs(tx, tenantId, paymentId);

            const updated = await tx.supplierCreditTransaction.update({
                where: { id: paymentId },
                data: {
                    type: newType,
                    amount: newAmount,
                    discount_amount: newDiscount,
                    balance_after: balanceAfter,
                    notes: newNotes,
                    created_at: newDate,
                    payment_number: newNumber,
                    ...(newMethod ? { payment_method_id: newMethod.id, payment_method_name: newMethod.name } : {}),
                },
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.supplier.update({
                where: { id: supplierId },
                data: { due_balance: balanceAfter },
            });

            // A method left alone reposts to wherever it is linked today.
            const cashAccountId = newMethod
                ? newMethod.account_id ?? undefined
                : await storedPaymentMethodAccountId(tx, tenantId, payment.payment_method_id);

            const posting = await this.postPaymentLegs(tx, {
                tenantId,
                supplierId,
                supplierName: supplier.name,
                paymentId,
                paymentNumber: newNumber ?? paymentId,
                type: newType,
                amount: newAmount,
                discount: newDiscount,
                date: newDate,
                cashAccountId,
                storeId: payment.store_id,
            });

            return { ...updated, ...posting };
        }).catch((err) => {
            if (newNumber && isSerialConflict(err)) throw serialTaken(newNumber);
            throw err;
        });
    }

    async deleteCreditPayment(tenantId: string, paymentId: string, scope: SupplierScope = null) {
        const payment = await this.findCreditPaymentOrThrow(tenantId, paymentId, scope);
        const oldType = payment.type as 'PAYMENT' | 'PAYOUT';
        const oldAmount = Number(payment.amount);
        const oldDiscount = Number(payment.discount_amount ?? 0);

        const allocationCount = await this.db.supplierPaymentAllocation.count({
            where: { tenant_id: tenantId, transaction_id: paymentId },
        });
        if (allocationCount > 0) {
            throw new BadRequestException('Remove this payment\'s bill allocations before deleting it.');
        }

        return this.db.$transaction(async (tx) => {
            const supplier = await tx.supplier.findFirst({
                where: { id: payment.supplier_id, tenant_id: tenantId },
                select: { id: true, due_balance: true },
            });
            if (!supplier) throw new NotFoundException('Supplier not found');

            const newDue = Number(supplier.due_balance) - this.dueDelta(oldType, oldAmount, oldDiscount);

            await this.voidPaymentLegs(tx, tenantId, paymentId);

            await tx.supplierCreditTransaction.delete({ where: { id: paymentId } });

            await tx.supplier.update({
                where: { id: payment.supplier_id },
                data: { due_balance: newDue },
            });

            return { deleted: true, id: paymentId };
        });
    }

    async recordCreditPayment(
        tenantId: string,
        id: string,
        userId: string,
        dto: RecordSupplierCreditPaymentDto,
        timeZone?: string,
        scope: SupplierScope = null,
    ) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
            select: { id: true, name: true, due_balance: true, store_id: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const direction = dto.direction ?? SupplierPaymentDirectionDto.PAY;
        const txType = this.typeFromDirection(direction);
        const discount = dto.discount ?? 0;

        if (dto.allocations?.length && txType !== 'PAYMENT') {
            throw new BadRequestException('Only payments made to the supplier (not receipts) can be allocated to bills.');
        }

        const currentDue = Number(supplier.due_balance);
        this.assertPaymentSplit(txType, dto.amount, discount, currentDue);
        const balanceAfter = currentDue + this.dueDelta(txType, dto.amount, discount);
        const paymentDate = resolvePaymentDate(dto.date, timeZone) ?? new Date();
        const typedRaw = typedSerial(dto.paymentNumber);
        const typed = typedRaw && canonicalSerial(typedRaw, SERIAL_SERIES);
        // Kept outside the transaction so a unique-index race can name it.
        let serial = typed;
        const method = dto.paymentMethodId
            ? await resolveCreditPaymentMethod(this.db, tenantId, dto.paymentMethodId)
            : null;

        return this.db.$transaction(async (tx) => {
            if (typed) {
                await assertSerialFree(tx, 'supplierCreditTransaction', tenantId, typed);
                await assertNotAheadOfSeries(tx, 'SupplierCreditTransaction', tenantId, typed, SERIAL_SERIES);
            }
            const payment_number = typed ?? await nextSupplierPaymentNumber(tenantId, tx, txType);
            serial = payment_number;

            const payment = await tx.supplierCreditTransaction.create({
                data: {
                    tenant_id: tenantId,
                    supplier_id: id,
                    // A payment belongs to its supplier's branch.
                    store_id: supplier.store_id,
                    type: txType,
                    amount: dto.amount,
                    discount_amount: discount,
                    balance_after: balanceAfter,
                    payment_number,
                    notes: dto.notes,
                    payment_method_id: method?.id,
                    payment_method_name: method?.name,
                    created_by: userId,
                    created_at: paymentDate,
                },
                include: {
                    supplier: { select: { id: true, name: true, phone: true } },
                    creator: { select: { id: true, name: true } },
                },
            });

            await tx.supplier.update({
                where: { id },
                data: { due_balance: balanceAfter },
            });

            if (dto.allocations?.length) {
                // A discount settles bills exactly as money does: ৳4,998 paid
                // plus ৳2 let off clears a ৳5,000 bill.
                await this.applyAllocations(tx, tenantId, id, payment.id, dto.allocations, dto.amount + discount);
            }

            const posting = await this.postPaymentLegs(tx, {
                tenantId,
                supplierId: id,
                supplierName: supplier.name,
                paymentId: payment.id,
                paymentNumber: payment_number,
                type: txType,
                amount: dto.amount,
                discount,
                date: paymentDate,
                cashAccountId: method?.account_id ?? undefined,
                storeId: supplier.store_id,
            });

            return { ...payment, ...posting };
        }).catch((err) => {
            if (serial && isSerialConflict(err)) throw serialTaken(serial);
            throw err;
        });
    }

    /** Matches part or all of an existing (previously unapplied) supplier payment to specific bill(s). */
    async allocatePayment(tenantId: string, transactionId: string, dto: AllocateSupplierPaymentDto, scope: SupplierScope = null) {
        const transaction = await this.db.supplierCreditTransaction.findFirst({
            where: { id: transactionId, tenant_id: tenantId, type: 'PAYMENT', ...supplierRowScopeWhere(scope) },
        });
        if (!transaction) throw new NotFoundException('Supplier payment not found');

        const alreadyAllocated = await this.db.supplierPaymentAllocation.aggregate({
            where: { tenant_id: tenantId, transaction_id: transactionId },
            _sum: { amount: true },
        });
        const remaining = this.settledBy(transaction) - Number(alreadyAllocated._sum.amount ?? 0);

        return this.db.$transaction(async (tx) => {
            await this.applyAllocations(tx, tenantId, transaction.supplier_id, transactionId, dto.allocations, remaining);
            return this.getCreditPayment(tenantId, transactionId);
        });
    }

    /** Reverses a single bill allocation, freeing that amount back up as an unapplied advance. */
    async removeAllocation(tenantId: string, allocationId: string, scope: SupplierScope = null) {
        const allocation = await this.db.supplierPaymentAllocation.findFirst({
            where: { id: allocationId, tenant_id: tenantId, ...(scope ? { transaction: supplierRowScopeWhere(scope) } : {}) },
            include: { purchase: { select: { id: true, total_amount: true, paid_amount: true } } },
        });
        if (!allocation) throw new NotFoundException('Allocation not found');

        return this.db.$transaction(async (tx) => {
            await tx.supplierPaymentAllocation.delete({ where: { id: allocationId } });

            const newPaidAmount = Number(allocation.purchase.paid_amount) - Number(allocation.amount);
            await tx.purchase.update({
                where: { id: allocation.purchase.id },
                data: {
                    paid_amount: newPaidAmount,
                    payment_status: this.paymentStatusFor(newPaidAmount, Number(allocation.purchase.total_amount)),
                },
            });

            return { removed: true, id: allocationId };
        });
    }

    /** Open bills and unapplied advance total for a supplier - the working view for matching payments to bills. */
    async getBillingSummary(tenantId: string, supplierId: string, scope: SupplierScope = null) {
        const supplier = await this.db.supplier.findFirst({
            where: { id: supplierId, tenant_id: tenantId, deleted_at: null, ...supplierScopeWhere(scope) },
            select: { id: true, name: true, due_balance: true },
        });
        if (!supplier) throw new NotFoundException('Supplier not found');

        const openBills = await this.db.purchase.findMany({
            where: { tenant_id: tenantId, supplier_id: supplierId, payment_status: { not: 'PAID' }, ...ACTIVE_PURCHASE },
            select: {
                id: true,
                purchase_number: true,
                total_amount: true,
                paid_amount: true,
                payment_status: true,
                created_at: true,
            },
            orderBy: { created_at: 'asc' },
        });

        const paymentTransactions = await this.db.supplierCreditTransaction.findMany({
            where: { tenant_id: tenantId, supplier_id: supplierId, type: 'PAYMENT' },
            include: { allocations: { select: { amount: true } } },
        });

        const unallocatedAdvance = paymentTransactions.reduce((sum, txn) => {
            const allocated = txn.allocations.reduce((s, a) => s + Number(a.amount), 0);
            const remaining = this.settledBy(txn) - allocated;
            return sum + Math.max(0, remaining);
        }, 0);

        return {
            supplier: { id: supplier.id, name: supplier.name },
            due_balance: Number(supplier.due_balance),
            unallocated_advance: unallocatedAdvance,
            open_bills: openBills.map((bill: any) => ({
                ...bill,
                total_amount: Number(bill.total_amount),
                paid_amount: Number(bill.paid_amount),
                balance_due: Number(bill.total_amount) - Number(bill.paid_amount),
            })),
        };
    }
}
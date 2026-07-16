import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ensureInterBranchAccounts } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { AccountCategory, VoucherAttribution, VoucherType } from '../accounting/accounting.constants';
import { assertFiscalPeriodOpen } from '../accounting/posting.utils';
import { InitiateFundTransferDto, ListFundTransfersQueryDto } from './fund-transfers.dto';

const VOUCHER_PREFIX = 'FT';

@Injectable()
export class FundTransfersService {
    constructor(private readonly db: DatabaseService) {}

    async initiate(tenantId: string, userId: string, dto: InitiateFundTransferDto) {
        if (dto.sourceStoreId === dto.destinationStoreId) {
            throw new BadRequestException('Source and destination stores must be different.');
        }

        await this.assertStoreExists(tenantId, dto.sourceStoreId);
        await this.assertStoreExists(tenantId, dto.destinationStoreId);

        return this.db.$transaction(async (tx) => {
            await ensureInterBranchAccounts(tx, tenantId);

            const { cashAccountId, dueFromAccountId } = await this.resolveInterBranchAccounts(tx, tenantId);

            const transfer = await tx.fundTransfer.create({
                data: {
                    tenant_id: tenantId,
                    source_store_id: dto.sourceStoreId,
                    destination_store_id: dto.destinationStoreId,
                    amount: dto.amount,
                    method: dto.method ?? 'CASH',
                    description: dto.description,
                    status: 'INITIATED',
                    initiated_by: userId,
                },
            });

            const voucherNumber = await this.generateVoucherNumber(tx, tenantId, VoucherType.FUND_TRANSFER);
            // No explicit `date` is passed below, so the voucher is dated with the
            // schema's `@default(now())` - guard the same date so locking a period
            // actually stops this write.
            await assertFiscalPeriodOpen(tx, tenantId, new Date());
            const sourceVoucher = await tx.voucher.create({
                data: {
                    tenant_id: tenantId,
                    voucher_number: voucherNumber,
                    voucher_type: VoucherType.FUND_TRANSFER,
                    source_module: 'fund_transfers',
                    source_type: 'fund_transfer_initiate',
                    source_id: transfer.id,
                    idempotency_key: `${tenantId}:fund_transfer_initiate:${transfer.id}`,
                    description: dto.description ?? `Fund transfer to destination store`,
                    store_id: dto.sourceStoreId,
                    attribution: VoucherAttribution.INTER_BRANCH,
                    counterparty_store_id: dto.destinationStoreId,
                    details: {
                        create: [
                            {
                                account_id: dueFromAccountId,
                                debit_amount: new Prisma.Decimal(dto.amount),
                                credit_amount: new Prisma.Decimal(0),
                            },
                            {
                                account_id: cashAccountId,
                                debit_amount: new Prisma.Decimal(0),
                                credit_amount: new Prisma.Decimal(dto.amount),
                            },
                        ],
                    },
                },
            });

            return tx.fundTransfer.update({
                where: { id: transfer.id },
                data: {
                    status: 'IN_TRANSIT',
                    source_voucher_id: sourceVoucher.id,
                },
                include: this.transferInclude(),
            });
        });
    }

    async receive(tenantId: string, userId: string, id: string) {
        return this.db.$transaction(async (tx) => {
            const transfer = await tx.fundTransfer.findFirst({
                where: { id, tenant_id: tenantId },
            });

            if (!transfer) {
                throw new NotFoundException('Fund transfer not found.');
            }

            if (transfer.status === 'RECEIVED') {
                throw new BadRequestException('Fund transfer has already been received.');
            }

            if (transfer.status === 'CANCELLED') {
                throw new BadRequestException('Cancelled fund transfers cannot be received.');
            }

            if (!transfer.source_voucher_id) {
                throw new BadRequestException('Fund transfer source voucher is missing.');
            }

            await ensureInterBranchAccounts(tx, tenantId);
            const { cashAccountId, dueToAccountId } = await this.resolveInterBranchAccounts(tx, tenantId);

            const voucherNumber = await this.generateVoucherNumber(tx, tenantId, VoucherType.FUND_TRANSFER);
            // No explicit `date` is passed below, so the voucher is dated with the
            // schema's `@default(now())` - guard the same date so locking a period
            // actually stops this write.
            await assertFiscalPeriodOpen(tx, tenantId, new Date());
            const destinationVoucher = await tx.voucher.create({
                data: {
                    tenant_id: tenantId,
                    voucher_number: voucherNumber,
                    voucher_type: VoucherType.FUND_TRANSFER,
                    source_module: 'fund_transfers',
                    source_type: 'fund_transfer_receive',
                    source_id: transfer.id,
                    idempotency_key: `${tenantId}:fund_transfer_receive:${transfer.id}`,
                    description: transfer.description ?? `Fund transfer received from source store`,
                    store_id: transfer.destination_store_id,
                    attribution: VoucherAttribution.INTER_BRANCH,
                    counterparty_store_id: transfer.source_store_id,
                    details: {
                        create: [
                            {
                                account_id: cashAccountId,
                                debit_amount: transfer.amount,
                                credit_amount: new Prisma.Decimal(0),
                            },
                            {
                                account_id: dueToAccountId,
                                debit_amount: new Prisma.Decimal(0),
                                credit_amount: transfer.amount,
                            },
                        ],
                    },
                },
            });

            return tx.fundTransfer.update({
                where: { id: transfer.id },
                data: {
                    status: 'RECEIVED',
                    received_by: userId,
                    received_at: new Date(),
                    destination_voucher_id: destinationVoucher.id,
                },
                include: this.transferInclude(),
            });
        });
    }

    async list(tenantId: string, query: ListFundTransfersQueryDto = {}) {
        return this.db.fundTransfer.findMany({
            where: {
                tenant_id: tenantId,
                ...(query.status ? { status: query.status } : {}),
                ...(query.sourceStoreId ? { source_store_id: query.sourceStoreId } : {}),
                ...(query.destinationStoreId ? { destination_store_id: query.destinationStoreId } : {}),
            },
            include: this.transferInclude(),
            orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        });
    }

    async get(tenantId: string, id: string) {
        const transfer = await this.db.fundTransfer.findFirst({
            where: { id, tenant_id: tenantId },
            include: this.transferInclude(),
        });

        if (!transfer) {
            throw new NotFoundException('Fund transfer not found.');
        }

        return transfer;
    }

    private transferInclude() {
        return {
            sourceStore: { select: { id: true, name: true } },
            destinationStore: { select: { id: true, name: true } },
            initiatedByUser: { select: { id: true, name: true, email: true } },
            receivedByUser: { select: { id: true, name: true, email: true } },
            sourceVoucher: { select: { id: true, voucher_number: true, voucher_type: true } },
            destinationVoucher: { select: { id: true, voucher_number: true, voucher_type: true } },
        };
    }

    private async assertStoreExists(tenantId: string, storeId: string) {
        const store = await this.db.store.findFirst({
            where: { id: storeId, tenant_id: tenantId },
            select: { id: true },
        });
        if (!store) {
            throw new NotFoundException('Store not found.');
        }
    }

    private async resolveInterBranchAccounts(tx: Prisma.TransactionClient, tenantId: string) {
        const cashAccount = await tx.account.findFirst({
            where: { tenant_id: tenantId, name: 'Cash in Hand' },
            select: { id: true },
        }) ?? await tx.account.findFirst({
            where: { tenant_id: tenantId, category: AccountCategory.CASH },
            orderBy: { code: 'asc' },
            select: { id: true },
        });

        const dueFromAccount = await tx.account.findFirst({
            where: { tenant_id: tenantId, name: 'Due from Branches' },
            select: { id: true },
        });
        const dueToAccount = await tx.account.findFirst({
            where: { tenant_id: tenantId, name: 'Due to Branches' },
            select: { id: true },
        });

        if (!cashAccount || !dueFromAccount || !dueToAccount) {
            throw new BadRequestException('Inter-branch accounts are not configured for this tenant.');
        }

        return {
            cashAccountId: cashAccount.id,
            dueFromAccountId: dueFromAccount.id,
            dueToAccountId: dueToAccount.id,
        };
    }

    private async generateVoucherNumber(
        tx: Prisma.TransactionClient,
        tenantId: string,
        voucherType: string,
    ) {
        const sequence = await tx.voucherSequence.upsert({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: tenantId,
                    voucher_type: voucherType,
                },
            },
            update: {},
            create: {
                id: `${tenantId}:${voucherType}`,
                tenant_id: tenantId,
                voucher_type: voucherType,
                prefix: VOUCHER_PREFIX,
                next_number: 1,
            },
        });

        const nextNumber = sequence.next_number;
        await tx.voucherSequence.update({
            where: {
                tenant_id_voucher_type: {
                    tenant_id: tenantId,
                    voucher_type: voucherType,
                },
            },
            data: { next_number: { increment: 1 } },
        });

        return `${VOUCHER_PREFIX}-${String(nextNumber).padStart(5, '0')}`;
    }
}
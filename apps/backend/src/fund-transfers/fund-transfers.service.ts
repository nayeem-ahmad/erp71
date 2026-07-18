import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ensureInterBranchAccounts } from '@erp71/database';
import { DatabaseService } from '../database/database.service';
import { VoucherAttribution } from '../accounting/accounting.constants';
import { autoPostFromRules } from '../accounting/posting.utils';
import { InitiateFundTransferDto, ListFundTransfersQueryDto } from './fund-transfers.dto';

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
            // Ensure the Due from/to Branches accounts exist for the rule to resolve.
            await ensureInterBranchAccounts(tx, tenantId);

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

            // Dr Due from Branches / Cr Cash. legKey 'initiate' distinguishes this
            // from the 'receive' leg, which shares the transfer's source id.
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'fund_transfer',
                conditionKey: 'transfer_scope',
                conditionValue: 'initiate',
                sourceModule: 'fund_transfers',
                sourceType: 'fund_transfer_initiate',
                sourceId: transfer.id,
                legKey: 'initiate',
                amount: dto.amount,
                description: dto.description ?? 'Fund transfer to destination store',
                storeId: dto.sourceStoreId,
                attribution: VoucherAttribution.INTER_BRANCH,
                counterpartyStoreId: dto.destinationStoreId,
            });

            return tx.fundTransfer.update({
                where: { id: transfer.id },
                data: {
                    status: 'IN_TRANSIT',
                    source_voucher_id: posting.voucherId ?? null,
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

            // Dr Cash / Cr Due to Branches. legKey 'receive' — the second leg of
            // this transfer.
            const posting = await autoPostFromRules({
                tx,
                tenantId,
                eventType: 'fund_transfer',
                conditionKey: 'transfer_scope',
                conditionValue: 'receive',
                sourceModule: 'fund_transfers',
                sourceType: 'fund_transfer_receive',
                sourceId: transfer.id,
                legKey: 'receive',
                amount: Number(transfer.amount),
                description: transfer.description ?? 'Fund transfer received from source store',
                storeId: transfer.destination_store_id,
                attribution: VoucherAttribution.INTER_BRANCH,
                counterpartyStoreId: transfer.source_store_id,
            });

            return tx.fundTransfer.update({
                where: { id: transfer.id },
                data: {
                    status: 'RECEIVED',
                    received_by: userId,
                    received_at: new Date(),
                    destination_voucher_id: posting.voucherId ?? null,
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
}
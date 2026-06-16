import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { VoucherType } from './accounting.constants';

export type PostingEventType =
    | 'sale'
    | 'sale_return'
    | 'purchase'
    | 'purchase_return'
    | 'inventory_adjustment'
    | 'fund_movement'
    | 'expense';

export interface AutoPostInput {
    tx: Prisma.TransactionClient;
    tenantId: string;
    eventType: PostingEventType;
    conditionKey?: 'payment_mode' | 'reason_type' | 'transfer_scope' | 'none';
    conditionValue?: string | null;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    amount: number;
    description?: string;
    referenceNumber?: string;
    date?: Date;
}

export interface AutoPostResult {
    postingStatus: 'posted' | 'skipped';
    voucherId?: string;
    voucherNumber?: string;
    voucherType?: string;
}

const VOUCHER_PREFIXES: Record<string, string> = {
    [VoucherType.CASH_PAYMENT]: 'CP',
    [VoucherType.CASH_RECEIVE]: 'CR',
    [VoucherType.BANK_PAYMENT]: 'BP',
    [VoucherType.BANK_RECEIVE]: 'BR',
    [VoucherType.FUND_TRANSFER]: 'FT',
    [VoucherType.JOURNAL]: 'JV',
};

const VOUCHER_TYPE_BY_EVENT: Record<PostingEventType, string> = {
    sale: VoucherType.CASH_RECEIVE,
    sale_return: VoucherType.CASH_PAYMENT,
    purchase: VoucherType.CASH_PAYMENT,
    purchase_return: VoucherType.CASH_RECEIVE,
    inventory_adjustment: VoucherType.JOURNAL,
    fund_movement: VoucherType.FUND_TRANSFER,
    expense: VoucherType.CASH_PAYMENT,
};

function voucherSequenceId(tenantId: string, voucherType: string) {
    return `${tenantId}:${voucherType}`;
}

async function generateVoucherNumber(tx: Prisma.TransactionClient, tenantId: string, voucherType: string) {
    const prefix = VOUCHER_PREFIXES[voucherType] ?? 'JV';
    const sequence = await tx.voucherSequence.upsert({
        where: {
            tenant_id_voucher_type: {
                tenant_id: tenantId,
                voucher_type: voucherType,
            },
        },
        update: {},
        create: {
            id: voucherSequenceId(tenantId, voucherType),
            tenant_id: tenantId,
            voucher_type: voucherType,
            prefix,
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
        data: {
            next_number: {
                increment: 1,
            },
        },
    });

    return `${prefix}-${String(nextNumber).padStart(5, '0')}`;
}

export async function autoPostFromRules(input: AutoPostInput): Promise<AutoPostResult> {
    const conditionKey = input.conditionKey ?? 'none';
    const conditionValue = input.conditionValue ?? null;
    const idempotencyKey = `${input.tenantId}:${input.eventType}:${input.sourceId}`;

    const existingEvent = await input.tx.postingEvent.findUnique({
        where: {
            tenant_id_idempotency_key: {
                tenant_id: input.tenantId,
                idempotency_key: idempotencyKey,
            },
        },
        include: {
            voucher: true,
        },
    });

    if (existingEvent?.status === 'posted' && existingEvent.voucher) {
        return {
            postingStatus: 'posted',
            voucherId: existingEvent.voucher.id,
            voucherNumber: existingEvent.voucher.voucher_number,
            voucherType: existingEvent.voucher.voucher_type,
        };
    }

    const postingEvent = existingEvent
        ? await input.tx.postingEvent.update({
            where: { id: existingEvent.id },
            data: {
                status: 'pending',
                attempt_count: { increment: 1 },
                last_attempt_at: new Date(),
                last_error: null,
            },
        })
        : await input.tx.postingEvent.create({
            data: {
                tenant_id: input.tenantId,
                event_type: input.eventType,
                source_module: input.sourceModule,
                source_type: input.sourceType,
                source_id: input.sourceId,
                idempotency_key: idempotencyKey,
                status: 'pending',
                attempt_count: 1,
                last_attempt_at: new Date(),
            },
        });

    const postingRule = await input.tx.postingRule.findFirst({
        where: {
            tenant_id: input.tenantId,
            event_type: input.eventType,
            is_active: true,
            condition_key: conditionKey,
            condition_value: conditionValue,
        },
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    }) ?? await input.tx.postingRule.findFirst({
        where: {
            tenant_id: input.tenantId,
            event_type: input.eventType,
            is_active: true,
            condition_key: 'none',
            condition_value: null,
        },
        orderBy: [{ priority: 'asc' }, { updated_at: 'desc' }],
    });

    if (!postingRule) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'skipped',
                last_error: 'POSTING_RULE_NOT_CONFIGURED',
            },
        });
        return { postingStatus: 'skipped' };
    }

    if (input.amount <= 0) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'skipped',
                last_error: 'AUTO_POSTING_AMOUNT_INVALID',
            },
        });
        return { postingStatus: 'skipped' };
    }

    const accounts = await input.tx.account.findMany({
        where: {
            tenant_id: input.tenantId,
            id: { in: [postingRule.debit_account_id, postingRule.credit_account_id] },
        },
        select: { id: true },
    });

    if (accounts.length !== 2 || postingRule.debit_account_id === postingRule.credit_account_id) {
        await input.tx.postingEvent.update({
            where: { id: postingEvent.id },
            data: {
                status: 'failed',
                last_error: 'AUTO_POSTING_ACCOUNT_INVALID',
            },
        });
        throw new BadRequestException('AUTO_POSTING_ACCOUNT_INVALID');
    }

    const voucherType = VOUCHER_TYPE_BY_EVENT[input.eventType];
    const voucherNumber = await generateVoucherNumber(input.tx, input.tenantId, voucherType);

    const voucher = await input.tx.voucher.create({
        data: {
            tenant_id: input.tenantId,
            voucher_number: voucherNumber,
            voucher_type: voucherType,
            source_module: input.sourceModule,
            source_type: input.sourceType,
            source_id: input.sourceId,
            idempotency_key: idempotencyKey,
            description: input.description,
            reference_number: input.referenceNumber,
            date: input.date,
            details: {
                create: [
                    {
                        account_id: postingRule.debit_account_id,
                        debit_amount: new Prisma.Decimal(input.amount),
                        credit_amount: new Prisma.Decimal(0),
                    },
                    {
                        account_id: postingRule.credit_account_id,
                        debit_amount: new Prisma.Decimal(0),
                        credit_amount: new Prisma.Decimal(input.amount),
                    },
                ],
            },
        },
    });

    await input.tx.postingEvent.update({
        where: { id: postingEvent.id },
        data: {
            status: 'posted',
            voucher_id: voucher.id,
            last_error: null,
        },
    });

    return {
        postingStatus: 'posted',
        voucherId: voucher.id,
        voucherNumber: voucher.voucher_number,
        voucherType: voucher.voucher_type,
    };
}

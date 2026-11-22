import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { OPEN_CHEQUE_STATUSES } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { addCalendarDays, zonedDateString } from '../common/tenant-time.util';
import { CreateChequeDto, ListChequesQueryDto, UpdateChequeDto } from './cheques.dto';

export interface ChequeActor {
    tenantId: string;
    userId: string;
    storeId?: string;
    timezone?: string;
}

/** A `YYYY-MM-DD` day as Postgres `DATE` reads it through Prisma: UTC midnight. */
export function calendarDay(value: string): Date {
    return new Date(`${value}T00:00:00.000Z`);
}

/** A cheque as the screens read it: the amount as a number, the date as a day. */
export function serializeCheque<T extends { amount: Prisma.Decimal | number; cheque_date: Date }>(row: T) {
    return {
        ...row,
        amount: Number(row.amount),
        cheque_date: row.cheque_date.toISOString().slice(0, 10),
    };
}

/** How far ahead the register's "due this week" figure looks. */
const DUE_SOON_DAYS = 7;

@Injectable()
export class ChequesService {
    constructor(private readonly db: DatabaseService) {}

    /**
     * The register, newest cheque date first, with the totals the page heads
     * with: what is still outstanding each way, and what falls due this week.
     */
    async findAll(actor: ChequeActor, query: ListChequesQueryDto = {}) {
        const search = query.search?.trim();
        const where: Prisma.ChequeWhereInput = {
            tenant_id: actor.tenantId,
            ...(query.direction ? { direction: query.direction } : {}),
            ...(query.status === 'open'
                ? { status: { in: [...OPEN_CHEQUE_STATUSES] } }
                : query.status
                  ? { status: query.status }
                  : {}),
            ...(query.from || query.to
                ? {
                      cheque_date: {
                          ...(query.from ? { gte: calendarDay(query.from) } : {}),
                          ...(query.to ? { lte: calendarDay(query.to) } : {}),
                      },
                  }
                : {}),
            ...(search
                ? {
                      OR: [
                          { party_name: { contains: search, mode: 'insensitive' as const } },
                          { cheque_number: { contains: search, mode: 'insensitive' as const } },
                          { bank_name: { contains: search, mode: 'insensitive' as const } },
                      ],
                  }
                : {}),
        };

        const today = zonedDateString(new Date(), actor.timezone || 'Asia/Dhaka');
        const weekOut = addCalendarDays(today, DUE_SOON_DAYS);

        const [rows, open, dueSoon] = await Promise.all([
            this.db.cheque.findMany({
                where,
                orderBy: [{ cheque_date: 'desc' }, { created_at: 'desc' }],
                take: 500,
            }),
            this.db.cheque.groupBy({
                by: ['direction'],
                where: { tenant_id: actor.tenantId, status: { in: [...OPEN_CHEQUE_STATUSES] } },
                _sum: { amount: true },
                _count: { _all: true },
            }),
            this.db.cheque.groupBy({
                by: ['direction'],
                where: {
                    tenant_id: actor.tenantId,
                    status: { in: [...OPEN_CHEQUE_STATUSES] },
                    cheque_date: { lte: calendarDay(weekOut) },
                },
                _sum: { amount: true },
                _count: { _all: true },
            }),
        ]);

        const tally = (groups: typeof open, direction: string) => {
            const group = groups.find((row) => row.direction === direction);
            return { count: group?._count._all ?? 0, amount: Number(group?._sum.amount ?? 0) };
        };

        return {
            items: rows.map(serializeCheque),
            summary: {
                issuedOpen: tally(open, 'ISSUED'),
                receivedOpen: tally(open, 'RECEIVED'),
                issuedDueSoon: tally(dueSoon, 'ISSUED'),
                receivedDueSoon: tally(dueSoon, 'RECEIVED'),
                dueSoonDays: DUE_SOON_DAYS,
            },
        };
    }

    async findOne(actor: ChequeActor, id: string) {
        const row = await this.db.cheque.findFirst({ where: { id, tenant_id: actor.tenantId } });
        if (!row) throw new NotFoundException('Cheque not found.');
        return serializeCheque(row);
    }

    async create(actor: ChequeActor, dto: CreateChequeDto) {
        const row = await this.db.cheque.create({
            data: {
                tenant_id: actor.tenantId,
                store_id: actor.storeId ?? null,
                direction: dto.direction,
                status: dto.status ?? 'PENDING',
                bank_name: dto.bankName,
                branch_name: dto.branchName ?? null,
                account_number: dto.accountNumber ?? null,
                cheque_number: dto.chequeNumber,
                party_name: dto.partyName,
                amount: new Prisma.Decimal(dto.amount),
                cheque_date: calendarDay(dto.chequeDate),
                account_payee: dto.accountPayee ?? true,
                memo: dto.memo ?? null,
                created_by: actor.userId,
            },
        });
        return serializeCheque(row);
    }

    async update(actor: ChequeActor, id: string, dto: UpdateChequeDto) {
        const existing = await this.db.cheque.findFirst({
            where: { id, tenant_id: actor.tenantId },
            select: { id: true, status: true },
        });
        if (!existing) throw new NotFoundException('Cheque not found.');

        const statusChanged = dto.status !== undefined && dto.status !== existing.status;
        const row = await this.db.cheque.update({
            where: { id },
            data: {
                ...(dto.direction !== undefined ? { direction: dto.direction } : {}),
                ...(dto.bankName !== undefined ? { bank_name: dto.bankName } : {}),
                ...('branchName' in dto ? { branch_name: dto.branchName ?? null } : {}),
                ...('accountNumber' in dto ? { account_number: dto.accountNumber ?? null } : {}),
                ...(dto.chequeNumber !== undefined ? { cheque_number: dto.chequeNumber } : {}),
                ...(dto.partyName !== undefined ? { party_name: dto.partyName } : {}),
                ...(dto.amount !== undefined ? { amount: new Prisma.Decimal(dto.amount) } : {}),
                ...(dto.chequeDate !== undefined ? { cheque_date: calendarDay(dto.chequeDate) } : {}),
                ...(dto.accountPayee !== undefined ? { account_payee: dto.accountPayee } : {}),
                ...('memo' in dto ? { memo: dto.memo ?? null } : {}),
                ...(statusChanged ? { status: dto.status, status_changed_at: new Date() } : {}),
            },
        });
        return serializeCheque(row);
    }

    async remove(actor: ChequeActor, id: string) {
        const existing = await this.db.cheque.findFirst({
            where: { id, tenant_id: actor.tenantId },
            select: { id: true },
        });
        if (!existing) throw new NotFoundException('Cheque not found.');
        await this.db.cheque.delete({ where: { id } });
        return { id };
    }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { formatZonedDate, zonedDayRange } from '../common/tenant-time.util';
import {
    idsOrNoneClause,
    searchClause,
    statusSetClause,
    type SalesDocumentListFilters,
} from '../common/sales-document-list-filters';
import { resolveOrderBy, type SortableMap } from '../common/sort.util';
import { DatabaseService } from '../database/database.service';
import { issueDocumentNumber, numberTakenIn } from '../database/document-number.utils';
import { CreateWarrantyClaimDto, UpdateWarrantyClaimStatusDto } from './warranty-claim.dto';

const VALID_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'REPAIRED', 'REPLACED', 'COMPLETED'];

const WARRANTY_CLAIM_SORTABLE: SortableMap = {
    claim_number: (dir) => ({ claim_number: dir }),
    serial_number: (dir) => ({ serial_number: dir }),
    status: (dir) => ({ status: dir }),
    created_at: (dir) => ({ created_at: dir }),
    resolved_at: (dir) => ({ resolved_at: dir }),
    product: (dir) => ({ product: { name: dir } }),
    customer: (dir) => ({ customer: { name: dir } }),
};

/**
 * What narrows the warranty-claims list — and, alike, its stats strip. The
 * claim's own date (`dateFrom`/`dateTo`) is when it was resolved; `created*`
 * is when it was lodged.
 */
export interface WarrantyClaimListFilters extends Partial<Omit<SalesDocumentListFilters, 'timezone' | 'total'>> {
    timezone: string;
}

/** `GET /warranty-claims/summary` — see `WarrantyClaimsService.summary`. */
export interface WarrantyClaimListSummary {
    count: number;
    /** Lodged and not yet approved or rejected. */
    awaiting: number;
    /** Approved, with the repair or replacement still to happen. */
    inProgress: number;
    repaired: number;
    replaced: number;
    completed: number;
    rejected: number;
}

@Injectable()
export class WarrantyClaimsService {
    constructor(private db: DatabaseService) {}

    async lookup(tenantId: string, serialNumber: string) {
        const serial = await this.db.productSerial.findFirst({
            where: { tenant_id: tenantId, serial_number: serialNumber },
        });

        if (!serial) throw new NotFoundException(`Serial number "${serialNumber}" not found.`);

        const product = await this.db.product.findUnique({
            where: { id: serial.product_id },
        });

        if (!product?.warranty_enabled) {
            throw new BadRequestException(`Product does not have warranty enabled.`);
        }

        const sale = serial.source_id
            ? await this.db.sale.findUnique({
                  where: { id: serial.source_id },
                  include: { customer: true },
              })
            : null;

        const soldAt = serial.sold_at;
        const warrantyDays = product.warranty_duration_days ?? 0;
        const expiresAt = soldAt
            ? new Date(soldAt.getTime() + warrantyDays * 86400_000)
            : null;
        const isExpired = expiresAt ? expiresAt < new Date() : false;
        const isClaimed = serial.status === 'CLAIMED';

        return {
            serial,
            product,
            sale,
            customer: sale?.customer ?? null,
            warrantyDays,
            soldAt,
            expiresAt,
            isExpired,
            isClaimed,
            isClaimable: serial.status === 'SOLD' && !isExpired,
        };
    }

    async create(tenantId: string, dto: CreateWarrantyClaimDto) {
        return this.db.$transaction(async (tx) => {
            const serial = await tx.productSerial.findFirst({
                where: { tenant_id: tenantId, serial_number: dto.serialNumber },
            });

            if (!serial) {
                throw new NotFoundException(`Serial number "${dto.serialNumber}" not found.`);
            }

            if (serial.status === 'CLAIMED') {
                throw new BadRequestException(`A warranty claim already exists for serial "${dto.serialNumber}".`);
            }

            if (serial.status !== 'SOLD') {
                throw new BadRequestException(`Serial "${dto.serialNumber}" is not eligible for a warranty claim (status: ${serial.status}).`);
            }

            const product = await tx.product.findUnique({
                where: { id: serial.product_id },
            });

            if (!product?.warranty_enabled) {
                throw new BadRequestException(`Product does not have warranty enabled.`);
            }

            if (serial.sold_at && product.warranty_duration_days) {
                const expiresAt = new Date(
                    serial.sold_at.getTime() + product.warranty_duration_days * 86400_000,
                );
                if (expiresAt < new Date()) {
                    throw new BadRequestException(
                        `Warranty expired on ${formatZonedDate(expiresAt)}.`,
                    );
                }
            }

            const sale = serial.source_id
                ? await tx.sale.findUnique({ where: { id: serial.source_id } })
                : null;

            const claimNumber = await issueDocumentNumber(tx, {
                tenantId,
                docType: 'WARRANTY_CLAIM',
                storeId: dto.storeId,
                isTaken: numberTakenIn(tx.warrantyClaim, tenantId, 'claim_number'),
            });

            const claim = await tx.warrantyClaim.create({
                data: {
                    tenant_id: tenantId,
                    store_id: dto.storeId,
                    claim_number: claimNumber,
                    serial_number: dto.serialNumber,
                    product_id: serial.product_id,
                    sale_id: sale?.id ?? null,
                    customer_id: sale?.customer_id ?? null,
                    reason: dto.reason,
                    description: dto.description ?? null,
                    status: 'SUBMITTED',
                },
                include: { product: true, sale: true, customer: true, store: true },
            });

            await tx.productSerial.updateMany({
                where: { tenant_id: tenantId, serial_number: dto.serialNumber },
                data: { status: 'CLAIMED', claim_reference: claim.id },
            });

            return claim;
        });
    }

    /**
     * The `where` behind the warranty-claims list and its stats strip, so the
     * strip always counts the rows the list shows.
     */
    private listWhere(tenantId: string, opts?: WarrantyClaimListFilters): Prisma.WarrantyClaimWhereInput {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        const resolved = zonedDayRange(opts?.dateFrom, opts?.dateTo, opts?.timezone);
        const where: Prisma.WarrantyClaimWhereInput = {
            tenant_id: tenantId,
            ...(opts?.storeId ? { store_id: opts.storeId } : {}),
            ...(created ? { created_at: created } : {}),
            ...(resolved ? { resolved_at: resolved } : {}),
            ...(statusSetClause(opts?.statuses, opts?.statusExclude) as Prisma.WarrantyClaimWhereInput),
        };
        const and: Prisma.WarrantyClaimWhereInput[] = [];
        const search = searchClause(opts?.search, [
            'claim_number',
            'serial_number',
            'replacement_serial_number',
            'reason',
            'product.name',
            'customer.name',
            'customer.phone',
        ]);
        if (search) and.push(search as Prisma.WarrantyClaimWhereInput);
        const customer = idsOrNoneClause('customer_id', opts?.customerIds);
        if (customer) and.push(customer as Prisma.WarrantyClaimWhereInput);
        if (and.length) where.AND = and;
        return where;
    }

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: WarrantyClaimListFilters & { sortBy?: string; sortDir?: string },
    ): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.warrantyClaim.findMany({
                    ...(args as object),
                    include: { product: true, sale: true, customer: true, store: true },
                }),
            count: (args) => this.db.warrantyClaim.count(args as any),
            where: this.listWhere(tenantId, opts) as Record<string, unknown>,
            orderBy: resolveOrderBy(opts?.sortBy, opts?.sortDir, WARRANTY_CLAIM_SORTABLE, { created_at: 'desc' }),
            page,
            limit,
        });
    }

    /**
     * The stats strip above the warranty-claims list, over exactly the rows the
     * list shows: how many, and where they stand — waiting on a decision, being
     * repaired or replaced, closed, or turned down.
     */
    async summary(tenantId: string, opts: WarrantyClaimListFilters): Promise<WarrantyClaimListSummary> {
        const rows = await this.db.warrantyClaim.groupBy({
            by: ['status'],
            where: this.listWhere(tenantId, opts),
            _count: { _all: true },
        });
        const byStatus = new Map(rows.map((row) => [row.status, row._count._all]));
        const of = (status: string) => byStatus.get(status) ?? 0;
        return {
            count: rows.reduce((sum, row) => sum + row._count._all, 0),
            awaiting: of('SUBMITTED'),
            inProgress: of('APPROVED'),
            repaired: of('REPAIRED'),
            replaced: of('REPLACED'),
            completed: of('COMPLETED'),
            rejected: of('REJECTED'),
        };
    }

    async findOne(tenantId: string, id: string) {
        const claim = await this.db.warrantyClaim.findUnique({
            where: { id },
            include: { product: true, sale: true, customer: true, store: true },
        });

        if (!claim || claim.tenant_id !== tenantId) {
            throw new NotFoundException('Warranty claim not found.');
        }

        return claim;
    }

    async updateStatus(tenantId: string, id: string, dto: UpdateWarrantyClaimStatusDto) {
        return this.db.$transaction(async (tx) => {
            const claim = await tx.warrantyClaim.findUnique({ where: { id } });

            if (!claim || claim.tenant_id !== tenantId) {
                throw new NotFoundException('Warranty claim not found.');
            }

            if (!VALID_STATUSES.includes(dto.status)) {
                throw new BadRequestException(`Invalid status "${dto.status}".`);
            }

            let replacementSerial: string | null = claim.replacement_serial_number;

            if (dto.status === 'REPLACED') {
                const repSerial = dto.replacementSerialNumber?.trim();
                if (!repSerial) {
                    throw new BadRequestException('A replacement serial number is required when status is REPLACED.');
                }

                const replacementRecord = await tx.productSerial.findFirst({
                    where: { tenant_id: tenantId, serial_number: repSerial },
                });

                if (!replacementRecord) {
                    throw new NotFoundException(`Replacement serial "${repSerial}" not found.`);
                }

                if (replacementRecord.product_id !== claim.product_id) {
                    throw new BadRequestException(
                        `Replacement serial "${repSerial}" belongs to a different product.`,
                    );
                }

                if (replacementRecord.status !== 'IN_STOCK') {
                    throw new BadRequestException(
                        `Replacement serial "${repSerial}" is not available (status: ${replacementRecord.status}).`,
                    );
                }

                await tx.productSerial.updateMany({
                    where: { tenant_id: tenantId, serial_number: repSerial },
                    data: {
                        status: 'SOLD',
                        source_type: 'WARRANTY_REPLACEMENT',
                        source_id: claim.id,
                        sold_at: new Date(),
                    },
                });

                replacementSerial = repSerial;
            }

            const isResolved = ['REPAIRED', 'REPLACED', 'COMPLETED', 'REJECTED'].includes(dto.status);

            return tx.warrantyClaim.update({
                where: { id },
                data: {
                    status: dto.status,
                    resolution_notes: dto.resolutionNotes ?? claim.resolution_notes,
                    replacement_serial_number: replacementSerial,
                    resolved_at: isResolved && !claim.resolved_at ? new Date() : claim.resolved_at,
                },
                include: { product: true, sale: true, customer: true, store: true },
            });
        });
    }
}

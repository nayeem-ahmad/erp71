import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { createdAtRange } from '../common/created-range.util';
import { DatabaseService } from '../database/database.service';
import { CreateWarrantyClaimDto, UpdateWarrantyClaimStatusDto } from './warranty-claim.dto';

const VALID_STATUSES = ['SUBMITTED', 'APPROVED', 'REJECTED', 'REPAIRED', 'REPLACED', 'COMPLETED'];

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
                        `Warranty expired on ${expiresAt.toLocaleDateString()}.`,
                    );
                }
            }

            const sale = serial.source_id
                ? await tx.sale.findUnique({ where: { id: serial.source_id } })
                : null;

            const claimNumber = `WC-${Date.now()}`;

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

    async findAll(
        tenantId: string,
        page = 1,
        limit = 20,
        opts?: { createdFrom?: string; createdTo?: string; timezone: string },
    ): Promise<PaginatedResult<unknown>> {
        const created = createdAtRange(opts?.createdFrom, opts?.createdTo, opts?.timezone);
        return paginatedFindMany({
            findMany: (args) =>
                this.db.warrantyClaim.findMany({
                    ...(args as object),
                    include: { product: true, sale: true, customer: true, store: true },
                }),
            count: (args) => this.db.warrantyClaim.count(args as any),
            where: { tenant_id: tenantId, ...(created ? { created_at: created } : {}) },
            orderBy: { created_at: 'desc' },
            page,
            limit,
        });
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

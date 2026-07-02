import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { PriceListsService } from '../price-lists/price-lists.service';
import { CreateCustomerGroupDto, UpdateCustomerGroupDto } from './customer-group.dto';
import { runImport, ImportResult } from '../common/import.util';

@Injectable()
export class CustomerGroupsService {
    constructor(
        private db: DatabaseService,
        private priceListsService: PriceListsService,
    ) {}

    async create(tenantId: string, dto: CreateCustomerGroupDto) {
        const existing = await this.db.customerGroup.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });
        if (existing) {
            throw new BadRequestException('A customer group with this name already exists.');
        }

        if (dto.price_list_id) {
            await this.priceListsService.validatePriceListBelongsToTenant(tenantId, dto.price_list_id);
        }

        return this.db.customerGroup.create({
            data: { tenant_id: tenantId, ...dto },
            include: { priceList: { select: { id: true, name: true } } },
        });
    }

    async findAll(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.customerGroup.findMany({
                    ...(args as object),
                    include: {
                        priceList: { select: { id: true, name: true } },
                        _count: { select: { customers: true } },
                    },
                }),
            count: (args) => this.db.customerGroup.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: { name: 'asc' },
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const group = await this.db.customerGroup.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                priceList: { select: { id: true, name: true } },
                _count: { select: { customers: true } },
            },
        });
        if (!group) throw new NotFoundException('Customer group not found');
        return group;
    }

    async update(tenantId: string, id: string, dto: UpdateCustomerGroupDto) {
        await this.findOne(tenantId, id);

        if (dto.price_list_id) {
            await this.priceListsService.validatePriceListBelongsToTenant(tenantId, dto.price_list_id);
        }

        if (dto.name) {
            const duplicate = await this.db.customerGroup.findFirst({
                where: { tenant_id: tenantId, name: dto.name, NOT: { id } },
            });
            if (duplicate) {
                throw new BadRequestException('A customer group with this name already exists.');
            }
        }

        return this.db.customerGroup.update({
            where: { id },
            data: dto,
            include: { priceList: { select: { id: true, name: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const group = await this.findOne(tenantId, id);
        if ((group as any)._count.customers > 0) {
            throw new BadRequestException(
                'Cannot delete this group — it has associated customers. Reassign them first.',
            );
        }
        return this.db.customerGroup.delete({ where: { id } });
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                description: raw.description ? String(raw.description).trim() || null : null,
                discount_percent: (() => {
                    if (raw.discount_percent == null || raw.discount_percent === '') return null;
                    const n = Number(raw.discount_percent);
                    return isNaN(n) ? null : n;
                })(),
            }),
            findDuplicate: async (row) => {
                const existing = await this.db.customerGroup.findUnique({
                    where: { tenant_id_name: { tenant_id: tenantId, name: row.name } },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.db.customerGroup.create({
                    data: {
                        tenant_id: tenantId,
                        name: row.name,
                        description: row.description,
                        ...(row.discount_percent != null ? { discount_percent: row.discount_percent } : {}),
                    },
                });
            },
            update: async (id, row) => {
                await this.db.customerGroup.update({
                    where: { id },
                    data: {
                        name: row.name,
                        description: row.description,
                        ...(row.discount_percent != null ? { discount_percent: row.discount_percent } : {}),
                    },
                });
            },
        });
    }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateProductSubgroupDto, UpdateProductSubgroupDto } from './product-subgroup.dto';
import { runImport, ImportResult } from '../common/import.util';

@Injectable()
export class ProductSubgroupsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateProductSubgroupDto) {
        await this.assertGroupExists(tenantId, dto.groupId);

        const existing = await this.db.productSubgroup.findUnique({
            where: { group_id_name: { group_id: dto.groupId, name: dto.name } },
        });

        if (existing) {
            throw new BadRequestException('A product subgroup with this name already exists in the selected group.');
        }

        return this.db.productSubgroup.create({
            data: {
                tenant_id: tenantId,
                group_id: dto.groupId,
                name: dto.name,
                description: dto.description,
            },
            include: { group: true, _count: { select: { products: true } } },
        });
    }

    async findAll(tenantId: string, groupId?: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.productSubgroup.findMany({
                    ...(args as object),
                    include: {
                        group: true,
                        _count: { select: { products: true } },
                    },
                }),
            count: (args) => this.db.productSubgroup.count(args as any),
            where: {
                tenant_id: tenantId,
                ...(groupId ? { group_id: groupId } : {}),
            },
            orderBy: [{ group: { name: 'asc' } }, { name: 'asc' }],
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const subgroup = await this.db.productSubgroup.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                group: true,
                _count: { select: { products: true } },
            },
        });

        if (!subgroup) {
            throw new NotFoundException('Product subgroup not found');
        }

        return subgroup;
    }

    async update(tenantId: string, id: string, dto: UpdateProductSubgroupDto) {
        const existing = await this.findOne(tenantId, id);
        const nextGroupId = dto.groupId ?? existing.group_id;
        const nextName = dto.name ?? existing.name;

        await this.assertGroupExists(tenantId, nextGroupId);

        const duplicate = await this.db.productSubgroup.findFirst({
            where: {
                tenant_id: tenantId,
                group_id: nextGroupId,
                name: nextName,
                NOT: { id },
            },
        });

        if (duplicate) {
            throw new BadRequestException('A product subgroup with this name already exists in the selected group.');
        }

        return this.db.productSubgroup.update({
            where: { id },
            data: {
                ...(dto.groupId !== undefined ? { group_id: dto.groupId } : {}),
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
            },
            include: { group: true, _count: { select: { products: true } } },
        });
    }

    async remove(tenantId: string, id: string) {
        const subgroup = await this.findOne(tenantId, id);
        if ((subgroup as any)._count.products > 0) {
            throw new BadRequestException('Cannot delete this product subgroup — it has associated products.');
        }

        return this.db.productSubgroup.delete({ where: { id } });
    }

    async importRows(
        tenantId: string,
        rows: Record<string, unknown>[],
        mode: 'skip' | 'upsert',
    ): Promise<ImportResult> {
        return runImport(rows, mode, tenantId, {
            requiredFields: ['name', 'group_name'],
            castRow: (raw) => ({
                name: String(raw.name ?? '').trim(),
                group_name: String(raw.group_name ?? '').trim(),
                description: raw.description ? String(raw.description).trim() || null : null,
            }),
            findDuplicate: async (row) => {
                const group = await this.db.productGroup.findFirst({
                    where: { tenant_id: tenantId, name: { equals: row.group_name, mode: 'insensitive' } },
                });
                if (!group) return null;
                const existing = await this.db.productSubgroup.findUnique({
                    where: { group_id_name: { group_id: group.id, name: row.name } },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                const group = await this.db.productGroup.findFirst({
                    where: { tenant_id: tenantId, name: { equals: row.group_name, mode: 'insensitive' } },
                });
                if (!group) throw new Error(`Product group "${row.group_name}" not found`);
                await this.db.productSubgroup.create({
                    data: { tenant_id: tenantId, group_id: group.id, name: row.name, description: row.description },
                });
            },
            update: async (id, row) => {
                await this.db.productSubgroup.update({
                    where: { id },
                    data: { name: row.name, description: row.description },
                });
            },
        });
    }

    private async assertGroupExists(tenantId: string, groupId: string) {
        const group = await this.db.productGroup.findFirst({
            where: { id: groupId, tenant_id: tenantId },
        });

        if (!group) {
            throw new BadRequestException('Product group not found for this tenant.');
        }
    }
}
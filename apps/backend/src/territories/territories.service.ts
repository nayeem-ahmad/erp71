import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateTerritoryDto, UpdateTerritoryDto } from './territory.dto';
import { runImport, ImportResult } from '../common/import.util';

@Injectable()
export class TerritoriesService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateTerritoryDto) {
        const existing = await this.db.territory.findFirst({
            where: {
                tenant_id: tenantId,
                name: dto.name,
                parent_id: dto.parent_id ?? null,
            },
        });
        if (existing) {
            throw new BadRequestException('A territory with this name already exists under the same parent.');
        }

        if (dto.parent_id) {
            const parent = await this.db.territory.findFirst({
                where: { id: dto.parent_id, tenant_id: tenantId },
            });
            if (!parent) throw new BadRequestException('Parent territory not found.');
        }

        return this.db.territory.create({
            data: { tenant_id: tenantId, ...dto },
        });
    }

    async findAll(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) =>
                this.db.territory.findMany({
                    ...(args as object),
                    include: {
                        parent: { select: { id: true, name: true } },
                        _count: { select: { customers: true, children: true } },
                    },
                }),
            count: (args) => this.db.territory.count(args as any),
            where: { tenant_id: tenantId },
            orderBy: { name: 'asc' },
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const territory = await this.db.territory.findFirst({
            where: { id, tenant_id: tenantId },
            include: {
                parent: { select: { id: true, name: true } },
                _count: { select: { customers: true, children: true } },
            },
        });
        if (!territory) throw new NotFoundException('Territory not found');
        return territory;
    }

    async update(tenantId: string, id: string, dto: UpdateTerritoryDto) {
        await this.findOne(tenantId, id);

        if (dto.name) {
            const duplicate = await this.db.territory.findFirst({
                where: {
                    tenant_id: tenantId,
                    name: dto.name,
                    parent_id: dto.parent_id ?? null,
                    NOT: { id },
                },
            });
            if (duplicate) {
                throw new BadRequestException('A territory with this name already exists under the same parent.');
            }
        }

        return this.db.territory.update({
            where: { id },
            data: dto,
        });
    }

    async remove(tenantId: string, id: string) {
        const territory = await this.findOne(tenantId, id);
        const counts = (territory as any)._count;
        if (counts.customers > 0 || counts.children > 0) {
            throw new BadRequestException(
                'Cannot delete this territory — it has associated customers or child territories.',
            );
        }
        return this.db.territory.delete({ where: { id } });
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
            }),
            findDuplicate: async (row) => {
                const existing = await this.db.territory.findFirst({
                    where: { tenant_id: tenantId, name: { equals: row.name, mode: 'insensitive' }, parent_id: null },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.db.territory.create({
                    data: { tenant_id: tenantId, name: row.name, description: row.description },
                });
            },
            update: async (id, row) => {
                await this.db.territory.update({
                    where: { id },
                    data: { name: row.name, description: row.description },
                });
            },
        });
    }
}

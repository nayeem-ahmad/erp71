import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { paginatedFindMany } from '../common/list-pagination.util';
import { PaginatedResult } from '../common/pagination.dto';
import { DatabaseService } from '../database/database.service';
import { CreateBrandDto, UpdateBrandDto } from './brand.dto';
import { runImport, ImportResult } from '../common/import.util';

@Injectable()
export class BrandsService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateBrandDto) {
        const existing = await this.db.brand.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });

        if (existing) {
            throw new BadRequestException('A brand with this name already exists.');
        }

        return this.db.brand.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                description: dto.description,
                logo_url: dto.logo_url,
                website_url: dto.website_url,
            },
        });
    }

    async findAll(tenantId: string, page = 1, limit = 100): Promise<PaginatedResult<unknown>> {
        return paginatedFindMany({
            findMany: (args) => this.db.brand.findMany(args as any),
            count: (args) => this.db.brand.count(args as any),
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
            page,
            limit,
        });
    }

    async findOne(tenantId: string, id: string) {
        const brand = await this.db.brand.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!brand) {
            throw new NotFoundException('Brand not found');
        }

        return brand;
    }

    async update(tenantId: string, id: string, dto: UpdateBrandDto) {
        const brand = await this.db.brand.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!brand) {
            throw new NotFoundException('Brand not found');
        }

        if (dto.name && dto.name !== brand.name) {
            const duplicate = await this.db.brand.findUnique({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            if (duplicate) {
                throw new BadRequestException('A brand with this name already exists.');
            }
        }

        return this.db.brand.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.description !== undefined ? { description: dto.description } : {}),
                ...(dto.logo_url !== undefined ? { logo_url: dto.logo_url } : {}),
                ...(dto.website_url !== undefined ? { website_url: dto.website_url } : {}),
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const brand = await this.db.brand.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!brand) {
            throw new NotFoundException('Brand not found');
        }

        await this.db.brand.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        return { success: true };
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
                const existing = await this.db.brand.findUnique({
                    where: { tenant_id_name: { tenant_id: tenantId, name: row.name } },
                });
                return existing?.id ?? null;
            },
            create: async (row) => {
                await this.db.brand.create({
                    data: { tenant_id: tenantId, name: row.name, description: row.description },
                });
            },
            update: async (id, row) => {
                await this.db.brand.update({
                    where: { id },
                    data: { name: row.name, description: row.description },
                });
            },
        });
    }
}

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSupplierDto, UpdateSupplierDto } from './supplier.dto';

@Injectable()
export class SuppliersService {
    constructor(private db: DatabaseService) {}

    async create(tenantId: string, dto: CreateSupplierDto) {
        const existing = await this.db.supplier.findUnique({
            where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
        });

        if (existing) {
            throw new BadRequestException('A supplier with this name already exists.');
        }

        return this.db.supplier.create({
            data: {
                tenant_id: tenantId,
                name: dto.name,
                phone: dto.phone,
                email: dto.email,
                address: dto.address,
            },
        });
    }

    async findAll(tenantId: string) {
        return this.db.supplier.findMany({
            where: { tenant_id: tenantId, deleted_at: null },
            orderBy: { name: 'asc' },
        });
    }

    async findOne(tenantId: string, id: string) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        return supplier;
    }

    async update(tenantId: string, id: string, dto: UpdateSupplierDto) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        if (dto.name && dto.name !== supplier.name) {
            const duplicate = await this.db.supplier.findUnique({
                where: { tenant_id_name: { tenant_id: tenantId, name: dto.name } },
            });
            if (duplicate) {
                throw new BadRequestException('A supplier with this name already exists.');
            }
        }

        return this.db.supplier.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name } : {}),
                ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
                ...(dto.email !== undefined ? { email: dto.email } : {}),
                ...(dto.address !== undefined ? { address: dto.address } : {}),
            },
        });
    }

    async remove(tenantId: string, id: string) {
        const supplier = await this.db.supplier.findFirst({
            where: { id, tenant_id: tenantId, deleted_at: null },
        });

        if (!supplier) {
            throw new NotFoundException('Supplier not found');
        }

        await this.db.supplier.update({
            where: { id },
            data: { deleted_at: new Date() },
        });

        return { success: true };
    }
}
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateSupplierDto } from './supplier.dto';

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
}
import { Injectable, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class StoresService {
    constructor(private readonly db: DatabaseService) {}

    async rename(tenantId: string, storeId: string, name: string): Promise<{ id: string; name: string }> {
        const store = await this.db.store.findFirst({ where: { id: storeId, tenant_id: tenantId } });
        if (!store) {
            throw new NotFoundException('Store not found');
        }
        return this.db.store.update({
            where: { id: storeId },
            data: { name: name.trim() },
            select: { id: true, name: true },
        });
    }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { CreateCounterDto, UpdateCounterDto } from './counter.dto';

@Injectable()
export class CountersService {
  constructor(private db: DatabaseService) {}

  async create(tenantId: string, dto: CreateCounterDto) {
    const existing = await this.db.posCounter.findFirst({
      where: {
        tenant_id: tenantId,
        store_id: dto.storeId,
        counter_number: dto.counterNumber,
      },
    });

    if (existing) {
      throw new BadRequestException(`Counter number ${dto.counterNumber} already exists in this store`);
    }

    return this.db.posCounter.create({
      data: {
        tenant_id: tenantId,
        store_id: dto.storeId,
        name: dto.name,
        counter_number: dto.counterNumber,
        status: 'ACTIVE',
      },
    });
  }

  async findByStore(tenantId: string, storeId: string) {
    return this.db.posCounter.findMany({
      where: { tenant_id: tenantId, store_id: storeId },
      orderBy: { counter_number: 'asc' },
    });
  }

  async findActive(tenantId: string, storeId: string) {
    return this.db.posCounter.findMany({
      where: { tenant_id: tenantId, store_id: storeId, status: 'ACTIVE' },
      orderBy: { counter_number: 'asc' },
    });
  }

  async update(tenantId: string, counterId: string, dto: UpdateCounterDto) {
    const counter = await this.db.posCounter.findUnique({ where: { id: counterId } });

    if (!counter || counter.tenant_id !== tenantId) {
      throw new NotFoundException('Counter not found');
    }

    return this.db.posCounter.update({
      where: { id: counterId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.status !== undefined && { status: dto.status }),
      },
    });
  }

  async remove(tenantId: string, counterId: string) {
    const counter = await this.db.posCounter.findUnique({ where: { id: counterId } });

    if (!counter || counter.tenant_id !== tenantId) {
      throw new NotFoundException('Counter not found');
    }

    const hasOpenSession = await this.db.cashierSession.findFirst({
      where: { counter_id: counterId, status: 'OPEN' },
    });

    if (hasOpenSession) {
      throw new BadRequestException('Cannot delete a counter with an open cashier session');
    }

    return this.db.posCounter.delete({ where: { id: counterId } });
  }

  async validateCounterBelongsToStore(tenantId: string, counterId: string, storeId: string) {
    const counter = await this.db.posCounter.findUnique({ where: { id: counterId } });

    if (!counter || counter.tenant_id !== tenantId || counter.store_id !== storeId) {
      throw new BadRequestException('Counter does not belong to this store');
    }

    if (counter.status !== 'ACTIVE') {
      throw new BadRequestException('Counter is inactive');
    }

    return counter;
  }
}

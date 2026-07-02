import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodResponseDto,
  PaymentMethodType,
} from './payment-methods.dto';
import { runImport, ImportResult } from '../common/import.util';

@Injectable()
export class PaymentMethodsService {
  constructor(private readonly db: DatabaseService) {}

  async create(
    tenantId: string,
    dto: CreatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    // Check for duplicate name
    const existing = await this.db.paymentMethod.findFirst({
      where: {
        tenant_id: tenantId,
        name: dto.name,
      },
    });

    if (existing) {
      throw new BadRequestException('Payment method with this name already exists');
    }

    // Validate account exists if provided
    if (dto.account_id) {
      const account = await this.db.account.findUnique({
        where: { id: dto.account_id },
      });

      if (!account || account.tenant_id !== tenantId) {
        throw new BadRequestException('Invalid account ID or account does not belong to this tenant');
      }
    }

    const paymentMethod = await this.db.paymentMethod.create({
      data: {
        tenant_id: tenantId,
        type: dto.type,
        name: dto.name,
        account_id: dto.account_id || null,
        is_active: dto.is_active ?? true,
        sort_order: dto.sort_order ?? 0,
      },
    });

    return this.mapToResponse(paymentMethod);
  }

  async findAll(tenantId: string, type?: PaymentMethodType): Promise<PaymentMethodResponseDto[]> {
    const paymentMethods = await this.db.paymentMethod.findMany({
      where: {
        tenant_id: tenantId,
        ...(type && { type }),
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });

    return paymentMethods.map((pm) => this.mapToResponse(pm));
  }

  async findById(id: string, tenantId: string): Promise<PaymentMethodResponseDto> {
    const paymentMethod = await this.db.paymentMethod.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    return this.mapToResponse(paymentMethod);
  }

  async update(
    id: string,
    tenantId: string,
    dto: UpdatePaymentMethodDto,
  ): Promise<PaymentMethodResponseDto> {
    const paymentMethod = await this.db.paymentMethod.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    // Check for duplicate name if updating name
    if (dto.name && dto.name !== paymentMethod.name) {
      const existing = await this.db.paymentMethod.findFirst({
        where: {
          tenant_id: tenantId,
          name: dto.name,
        },
      });

      if (existing) {
        throw new BadRequestException('Payment method with this name already exists');
      }
    }

    // Validate account exists if updating account
    if (dto.account_id) {
      const account = await this.db.account.findUnique({
        where: { id: dto.account_id },
      });

      if (!account || account.tenant_id !== tenantId) {
        throw new BadRequestException('Invalid account ID or account does not belong to this tenant');
      }
    }

    const updated = await this.db.paymentMethod.update({
      where: { id },
      data: {
        type: dto.type,
        name: dto.name,
        account_id: dto.account_id ?? paymentMethod.account_id,
        is_active: dto.is_active ?? paymentMethod.is_active,
        sort_order: dto.sort_order ?? paymentMethod.sort_order,
      },
    });

    return this.mapToResponse(updated);
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const paymentMethod = await this.db.paymentMethod.findFirst({
      where: {
        id,
        tenant_id: tenantId,
      },
    });

    if (!paymentMethod) {
      throw new NotFoundException('Payment method not found');
    }

    await this.db.paymentMethod.delete({
      where: { id },
    });
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
        type: raw.type ? String(raw.type).trim() : 'Cash',
        is_active: raw.is_active !== undefined ? String(raw.is_active).toLowerCase() !== 'false' : true,
      }),
      findDuplicate: async (row) => {
        const existing = await this.db.paymentMethod.findFirst({
          where: { tenant_id: tenantId, name: row.name },
        });
        return existing?.id ?? null;
      },
      create: async (row) => {
        await this.db.paymentMethod.create({
          data: { tenant_id: tenantId, name: row.name, type: row.type, is_active: row.is_active },
        });
      },
      update: async (id, row) => {
        await this.db.paymentMethod.update({
          where: { id },
          data: { name: row.name, type: row.type, is_active: row.is_active },
        });
      },
    });
  }

  async getDefaultByType(
    tenantId: string,
    type: PaymentMethodType,
  ): Promise<PaymentMethodResponseDto | null> {
    const paymentMethod = await this.db.paymentMethod.findFirst({
      where: {
        tenant_id: tenantId,
        type,
        is_active: true,
      },
      orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
    });

    return paymentMethod ? this.mapToResponse(paymentMethod) : null;
  }

  private mapToResponse(pm: any): PaymentMethodResponseDto {
    return {
      id: pm.id,
      tenant_id: pm.tenant_id,
      type: pm.type,
      name: pm.name,
      account_id: pm.account_id,
      is_active: pm.is_active,
      sort_order: pm.sort_order,
      created_at: pm.created_at,
      updated_at: pm.updated_at,
    };
  }
}

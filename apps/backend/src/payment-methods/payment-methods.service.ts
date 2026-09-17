import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  CreatePaymentMethodDto,
  UpdatePaymentMethodDto,
  PaymentMethodAccountDto,
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
        show_on_entry: dto.show_on_entry ?? true,
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

  /**
   * Accounts the settings form can link a payment method to.
   *
   * Payment methods are a free-plan setting, but the only other account list —
   * `GET /accounting/accounts` — sits on `AccountingController`, which requires
   * the `premiumAccounting` entitlement and the VIEW_LEDGER store permission.
   * Calling it from here 403'd for every tenant without the accounting module,
   * which is why the picker came up empty. This returns names and codes only,
   * with no balances or ledger data, so it needs neither.
   */
  async findLinkableAccounts(tenantId: string): Promise<PaymentMethodAccountDto[]> {
    const accounts = await this.db.account.findMany({
      where: { tenant_id: tenantId },
      select: { id: true, name: true, code: true, type: true, category: true },
      // Fixed-width codes make a plain string sort the hierarchy order; accounts
      // still awaiting a code sort last under Postgres' NULLS LAST default.
      orderBy: [{ code: 'asc' }, { name: 'asc' }],
    });

    return accounts.map((account) => ({
      id: account.id,
      name: account.name,
      code: account.code ?? null,
      type: account.type,
      category: account.category,
    }));
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

    // `??` here meant an explicit null fell back to the stored account, so
    // clearing the link in the form silently kept the old one. Only an absent
    // key leaves the current value alone.
    const nextAccountId =
      dto.account_id === undefined ? paymentMethod.account_id : dto.account_id || null;

    const updated = await this.db.paymentMethod.update({
      where: { id },
      data: {
        type: dto.type,
        name: dto.name,
        account_id: nextAccountId,
        is_active: dto.is_active ?? paymentMethod.is_active,
        sort_order: dto.sort_order ?? paymentMethod.sort_order,
        show_on_entry: dto.show_on_entry ?? paymentMethod.show_on_entry,
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
      show_on_entry: pm.show_on_entry,
      created_at: pm.created_at,
      updated_at: pm.updated_at,
    };
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { normalizeInvoicePrintPrefs, type InvoicePrintPrefs } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import {
  UpdateSalesSettingsDto,
  SalesSettingsResponseDto,
  PaperSize,
  UpdateMemberInvoicePrintDto,
} from './sales-settings.dto';

@Injectable()
export class SalesSettingsService {
  constructor(private readonly db: DatabaseService) {}

  async getOrCreate(tenantId: string): Promise<SalesSettingsResponseDto> {
    let settings = await this.db.salesSettings.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!settings) {
      settings = await this.db.salesSettings.create({
        data: {
          tenant_id: tenantId,
          paper_size: PaperSize.A4,
          reference_number_format: 'YYMM-#',
        },
      });
    }

    return this.mapToResponse(settings);
  }

  async update(
    tenantId: string,
    dto: UpdateSalesSettingsDto,
  ): Promise<SalesSettingsResponseDto> {
    let settings = await this.db.salesSettings.findUnique({
      where: { tenant_id: tenantId },
    });

    if (!settings) {
      settings = await this.db.salesSettings.create({
        data: {
          tenant_id: tenantId,
          paper_size: dto.paper_size || PaperSize.A4,
          reference_number_format: dto.reference_number_format || 'YYMM-#',
        },
      });
    } else {
      settings = await this.db.salesSettings.update({
        where: { tenant_id: tenantId },
        data: {
          paper_size: dto.paper_size ?? settings.paper_size,
          reference_number_format: dto.reference_number_format ?? settings.reference_number_format,
          ...(dto.pos_enabled !== undefined ? { pos_enabled: dto.pos_enabled } : {}),
          ...(dto.require_cashier_session !== undefined
            ? { require_cashier_session: dto.require_cashier_session }
            : {}),
        },
      });
    }

    return this.mapToResponse(settings);
  }

  async get(tenantId: string): Promise<SalesSettingsResponseDto> {
    return this.getOrCreate(tenantId);
  }

  /**
   * The signed-in member's invoice layout in this workspace. Keyed on the
   * membership, so the same person keeps separate answers per workspace and
   * one member can never read another's.
   */
  async getMemberInvoicePrint(tenantId: string, userId: string): Promise<InvoicePrintPrefs> {
    const member = await this.db.tenantUser.findUnique({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
      select: { invoice_print_prefs: true },
    });
    if (!member) throw new NotFoundException('Not a member of this workspace.');
    return normalizeInvoicePrintPrefs(member.invoice_print_prefs);
  }

  /** Merges the change onto what the member already saved, and stores the whole set. */
  async updateMemberInvoicePrint(
    tenantId: string,
    userId: string,
    dto: UpdateMemberInvoicePrintDto,
  ): Promise<InvoicePrintPrefs> {
    const current = await this.getMemberInvoicePrint(tenantId, userId);
    const next = normalizeInvoicePrintPrefs({ ...current, ...dto });
    const saved = await this.db.tenantUser.update({
      where: { tenant_id_user_id: { tenant_id: tenantId, user_id: userId } },
      data: { invoice_print_prefs: next as any },
      select: { invoice_print_prefs: true },
    });
    return normalizeInvoicePrintPrefs(saved.invoice_print_prefs);
  }

  private mapToResponse(settings: any): SalesSettingsResponseDto {
    return {
      id: settings.id,
      tenant_id: settings.tenant_id,
      paper_size: settings.paper_size as PaperSize,
      reference_number_format: settings.reference_number_format,
      pos_enabled: settings.pos_enabled ?? true,
      // Off unless a tenant has deliberately turned it on: an upgrade must
      // not stop a shop mid-sale for a workflow it has never used.
      require_cashier_session: settings.require_cashier_session ?? false,
      created_at: settings.created_at,
      updated_at: settings.updated_at,
    };
  }
}

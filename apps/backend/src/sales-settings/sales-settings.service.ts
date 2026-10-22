import { Injectable } from '@nestjs/common';
import type { InvoicePrintPrefs } from '@erp71/shared-types';
import { DatabaseService } from '../database/database.service';
import { PreferencesService } from '../preferences/preferences.service';
import {
  UpdateSalesSettingsDto,
  SalesSettingsResponseDto,
  PaperSize,
  UpdateMemberInvoicePrintDto,
} from './sales-settings.dto';

@Injectable()
export class SalesSettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly preferences: PreferencesService,
  ) {}

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
          ...(dto.show_customer_credit !== undefined
            ? { show_customer_credit: dto.show_customer_credit }
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
   * The signed-in member's invoice layout in this workspace: their own saved
   * answers over their role's preference profile over the built-in layout.
   * Keyed on the membership, so the same person keeps separate answers per
   * workspace and one member can never read another's.
   */
  async getMemberInvoicePrint(tenantId: string, userId: string): Promise<InvoicePrintPrefs> {
    const { sections } = await this.preferences.resolveFor(tenantId, userId);
    return sections.invoicePrint.value;
  }

  /**
   * Stores only the fields submitted, onto the member's own saved answers, and
   * returns the layout they now get. Fields left out are not copied in from the
   * profile or built-ins, so a later profile change still reaches the member.
   */
  async updateMemberInvoicePrint(
    tenantId: string,
    userId: string,
    dto: UpdateMemberInvoicePrintDto,
  ): Promise<InvoicePrintPrefs> {
    const saved = await this.preferences.saveSection(tenantId, userId, 'invoicePrint', dto);
    return saved.value as InvoicePrintPrefs;
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
      // Off until a tenant admin turns it on: an upgrade must not change the
      // Customers list for a shop that never asked for a Credit column.
      show_customer_credit: settings.show_customer_credit ?? false,
      created_at: settings.created_at,
      updated_at: settings.updated_at,
    };
  }
}

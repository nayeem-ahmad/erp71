import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  UpdateSalesSettingsDto,
  SalesSettingsResponseDto,
  PaperSize,
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
        },
      });
    }

    return this.mapToResponse(settings);
  }

  async get(tenantId: string): Promise<SalesSettingsResponseDto> {
    return this.getOrCreate(tenantId);
  }

  private mapToResponse(settings: any): SalesSettingsResponseDto {
    return {
      id: settings.id,
      tenant_id: settings.tenant_id,
      paper_size: settings.paper_size as PaperSize,
      reference_number_format: settings.reference_number_format,
      pos_enabled: settings.pos_enabled ?? true,
      created_at: settings.created_at,
      updated_at: settings.updated_at,
    };
  }
}

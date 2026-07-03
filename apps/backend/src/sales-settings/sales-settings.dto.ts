import { IsString, IsOptional, IsEnum, IsBoolean } from 'class-validator';

export enum PaperSize {
  A4 = 'A4',
  A5 = 'A5',
  LETTER = 'Letter',
  THERMAL_80 = 'Thermal80',
  THERMAL_58 = 'Thermal58',
}

export class UpdateSalesSettingsDto {
  @IsOptional()
  @IsEnum(PaperSize)
  paper_size?: PaperSize;

  @IsOptional()
  @IsString()
  reference_number_format?: string;

  @IsOptional()
  @IsBoolean()
  pos_enabled?: boolean;
}

export class SalesSettingsResponseDto {
  id: string;
  tenant_id: string;
  paper_size: PaperSize;
  reference_number_format: string;
  pos_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

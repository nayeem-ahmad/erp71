import { IsString, IsOptional, IsEnum } from 'class-validator';

export enum PaperSize {
  A4 = 'A4',
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
}

export class SalesSettingsResponseDto {
  id: string;
  tenant_id: string;
  paper_size: PaperSize;
  reference_number_format: string;
  created_at: Date;
  updated_at: Date;
}

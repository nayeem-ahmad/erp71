import { IsString, IsOptional, IsEnum, IsBoolean, IsIn, MaxLength } from 'class-validator';
import {
  INVOICE_BALANCE_MODES,
  INVOICE_FOOTER_MAX_LENGTH,
  INVOICE_LAYOUTS,
  INVOICE_PADDINGS,
  INVOICE_TABLE_STYLES,
  type InvoiceBalanceMode,
  type InvoiceLayout,
  type InvoicePadding,
  type InvoiceTableStyle,
} from '@erp71/shared-types';

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

  @IsOptional()
  @IsBoolean()
  require_cashier_session?: boolean;

  @IsOptional()
  @IsBoolean()
  show_customer_credit?: boolean;
}

export class SalesSettingsResponseDto {
  id: string;
  tenant_id: string;
  paper_size: PaperSize;
  reference_number_format: string;
  pos_enabled: boolean;
  require_cashier_session: boolean;
  show_customer_credit: boolean;
  created_at: Date;
  updated_at: Date;
}

/**
 * A change to the signed-in member's invoice layout. Every field optional: the
 * service merges what is sent onto what the member already saved, so the
 * settings modal can send one switch without restating the rest.
 */
export class UpdateMemberInvoicePrintDto {
  @IsOptional()
  @IsIn(INVOICE_LAYOUTS)
  layout?: InvoiceLayout;

  @IsOptional()
  @IsIn(INVOICE_PADDINGS)
  padding?: InvoicePadding;

  @IsOptional()
  @IsIn(INVOICE_BALANCE_MODES)
  balance?: InvoiceBalanceMode;

  @IsOptional()
  @IsIn(INVOICE_TABLE_STYLES)
  table_style?: InvoiceTableStyle;

  @IsOptional()
  @IsBoolean()
  amount_in_words?: boolean;

  @IsOptional()
  @IsBoolean()
  serial_column?: boolean;

  @IsOptional()
  @IsBoolean()
  signature_lines?: boolean;

  @IsOptional()
  @IsBoolean()
  hide_empty_discount?: boolean;

  @IsOptional()
  @IsBoolean()
  hide_empty_warranty?: boolean;

  /**
   * `null` goes back to the built-in thank-you; `''` prints no footer.
   * `IsOptional` lets the null through without the string check.
   */
  @IsOptional()
  @IsString()
  @MaxLength(INVOICE_FOOTER_MAX_LENGTH)
  footer_text?: string | null;
}

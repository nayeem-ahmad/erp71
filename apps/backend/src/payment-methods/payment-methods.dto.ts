import { IsString, IsOptional, IsBoolean, IsInt, IsEnum } from 'class-validator';
import { PaymentMethodType } from '@erp71/shared-types';

// Re-exported so existing importers (controller, specs) keep working. The
// values live in @erp71/shared-types so the settings form validates against
// exactly what this DTO accepts — they must never drift apart.
export { PaymentMethodType };

export class CreatePaymentMethodDto {
  @IsEnum(PaymentMethodType)
  type: PaymentMethodType;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  account_id?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  show_on_entry?: boolean;
}

export class UpdatePaymentMethodDto {
  @IsOptional()
  @IsEnum(PaymentMethodType)
  type?: PaymentMethodType;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  account_id?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsBoolean()
  show_on_entry?: boolean;
}

export class PaymentMethodResponseDto {
  id: string;
  tenant_id: string;
  type: PaymentMethodType;
  name: string;
  account_id?: string;
  is_active: boolean;
  sort_order: number;
  show_on_entry: boolean;
  created_at: Date;
  updated_at: Date;
}

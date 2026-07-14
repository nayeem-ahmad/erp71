import { IsString, IsOptional, IsBoolean, IsInt, IsEnum } from 'class-validator';

export enum PaymentMethodType {
  CASH = 'Cash',
  MOBILE_WALLET = 'Mobile Wallet',
  CARD = 'Card',
  BANK = 'Bank',
}

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

import { IsString, IsOptional, IsBoolean, IsInt, IsEnum, IsArray } from 'class-validator';
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

  // Nullable as well as optional: the form's "no account linked" choice sends
  // an explicit null, and on update that null is what unlinks an account.
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

  /** Offered at every branch (the default). When false, only at `store_ids`. */
  @IsOptional()
  @IsBoolean()
  all_branches?: boolean;

  /** The branches a limited method is offered at; ignored when all_branches is true. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  store_ids?: string[];
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

  /** Offered at every branch (the default). When false, only at `store_ids`. */
  @IsOptional()
  @IsBoolean()
  all_branches?: boolean;

  /** The branches a limited method is offered at; ignored when all_branches is true. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  store_ids?: string[];
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
  /** Offered at every branch; when false, only at `store_ids`. */
  all_branches: boolean;
  /** The branches a limited method is offered at; empty when all_branches. */
  store_ids: string[];
  created_at: Date;
  updated_at: Date;
  /** The linked ledger account; only the list endpoint fills it in. */
  account?: { id: string; name: string; code: string | null } | null;
}

/**
 * Minimal account row for the "link a ledger account" picker on the payment
 * method form. Deliberately not the accounting module's account shape: it
 * carries no balances, so it needs none of that module's entitlements.
 */
export class PaymentMethodAccountDto {
  id: string;
  name: string;
  code: string | null;
  type: string;
  category: string;
}

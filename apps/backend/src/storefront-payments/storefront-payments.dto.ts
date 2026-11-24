import {
    IsString,
    IsNotEmpty,
    IsOptional,
    IsBoolean,
    IsInt,
    IsIn,
    IsObject,
    IsArray,
    ValidateNested,
    MaxLength,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PartialType } from '@nestjs/swagger';
import { PAYMENT_PROVIDER_ADAPTERS } from '@erp71/shared-types';

export class PaymentCredentialFieldDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(60)
    key: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    label: string;

    @IsOptional()
    @IsBoolean()
    secret?: boolean;

    @IsOptional()
    @IsBoolean()
    required?: boolean;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    placeholder?: string;

    @IsOptional()
    @IsString()
    @MaxLength(300)
    help?: string;
}

export class CreatePaymentProviderDto {
    /** Stable identifier stored on orders. Lower-case, no spaces. */
    @IsString()
    @IsNotEmpty()
    @MaxLength(40)
    code: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    description?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    logo_url?: string;

    @IsIn(PAYMENT_PROVIDER_ADAPTERS)
    adapter: string;

    @IsOptional()
    @IsString()
    @MaxLength(3)
    currency?: string;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsInt()
    @Min(0)
    sort_order?: number;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PaymentCredentialFieldDto)
    credential_fields: PaymentCredentialFieldDto[];

    @IsObject()
    config: Record<string, unknown>;
}

export class UpdatePaymentProviderDto extends PartialType(CreatePaymentProviderDto) {}

/** What a shop may change about its own account with a provider. */
export class UpdateTenantGatewayDto {
    @IsOptional()
    @IsBoolean()
    enabled?: boolean;

    @IsOptional()
    @IsIn(['sandbox', 'live'])
    mode?: 'sandbox' | 'live';

    /**
     * Keyed by the provider's `credential_fields[*].key`. A secret sent back as
     * the mask (or omitted) keeps the stored value.
     */
    @IsOptional()
    @IsObject()
    credentials?: Record<string, string>;
}

/**
 * The shopper is sent to the gateway by the storefront itself, so the order's
 * email is required as proof they hold the order they are paying for.
 */
export class InitiateStorefrontPaymentDto {
    @IsString()
    @IsNotEmpty()
    providerCode: string;

    @IsString()
    @IsNotEmpty()
    customerEmail: string;
}

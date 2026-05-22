import { IsString, IsIn, IsNumber, IsOptional, IsBoolean, IsDateString, Min, Max } from 'class-validator';

export class CreateDiscountCodeDto {
    @IsString()
    code: string;

    @IsString()
    name: string;

    @IsIn(['PERCENTAGE', 'FIXED'])
    type: string;

    @IsNumber()
    @Min(0)
    value: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    min_purchase?: number | null;

    @IsOptional()
    @IsNumber()
    @Min(0)
    max_discount?: number | null;

    @IsOptional()
    @IsNumber()
    @Min(1)
    usage_limit?: number | null;

    @IsOptional()
    @IsDateString()
    valid_from?: string | null;

    @IsOptional()
    @IsDateString()
    valid_until?: string | null;
}

export class ValidateDiscountCodeDto {
    @IsString()
    code: string;

    @IsNumber()
    @Min(0)
    cart_total: number;
}

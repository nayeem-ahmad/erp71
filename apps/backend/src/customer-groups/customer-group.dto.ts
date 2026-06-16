import { IsString, IsOptional, IsNumber, Min, Max, IsUUID } from 'class-validator';

export class CreateCustomerGroupDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsUUID()
    price_list_id?: string;
}

export class UpdateCustomerGroupDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsUUID()
    price_list_id?: string | null;
}

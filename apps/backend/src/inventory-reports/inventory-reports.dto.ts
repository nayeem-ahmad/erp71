import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetStockAgingDto {
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    /**
     * Stock with no outbound movement for at least this many days counts as
     * slow-moving. Defaults to 60 — long enough that ordinary seasonal dips do
     * not flag half the catalogue.
     */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(3650)
    slowMovingAfterDays?: number;
}

export class GetReorderSuggestionsDto {
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;
}

export class GetInventoryValuationDto {
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;
}

export class GetShrinkageSummaryDto {
    @IsOptional()
    @IsUUID()
    warehouseId?: string;

    @IsOptional()
    @IsUUID()
    reasonId?: string;

    @IsOptional()
    @IsUUID()
    productId?: string;

    @IsOptional()
    @IsUUID()
    groupId?: string;

    @IsOptional()
    @IsUUID()
    subgroupId?: string;

    @IsOptional()
    @IsString()
    from?: string;

    @IsOptional()
    @IsString()
    to?: string;
}
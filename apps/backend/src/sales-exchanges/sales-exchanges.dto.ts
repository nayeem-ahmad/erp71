import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator';

export class CreateSalesExchangeLineDto {
    @IsUUID()
    saleItemId: string;

    @IsInt()
    @Min(1)
    quantity: number;

    @IsUUID()
    replacementProductId: string;

    @IsInt()
    @Min(1)
    replacementQuantity: number;

    @IsNumber()
    @Min(0)
    unitPrice: number;
}

export class CreateSalesExchangeDto {
    @IsUUID()
    saleId: string;

    @IsOptional()
    @IsString()
    reason?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSalesExchangeLineDto)
    lines: CreateSalesExchangeLineDto[];
}

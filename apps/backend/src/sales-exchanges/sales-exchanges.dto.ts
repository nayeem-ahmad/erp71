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
import { SalesDocumentListQueryDto } from '../common/sales-document-list-filters';

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

/**
 * `GET /sales-exchanges` and its summary: the customer-document filters, plus
 * how the difference was settled.
 */
export class SalesExchangeListQueryDto extends SalesDocumentListQueryDto {
    /** Comma-separated settlement modes: `cash`, `bank`, `bkash`, `nagad`, `credit`. */
    @IsOptional()
    @IsString()
    settlement?: string;
}

import { Type } from 'class-transformer';
import {
    ArrayMinSize,
    IsArray,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

export class CreateSaleItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    priceAtSale: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    serialNumbers?: string[];
}

export class CreatePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    amount: number;

    @IsOptional()
    @IsString()
    accountId?: string; // Links payment to account for accounting
}

export class CreateSaleDto {
    @IsString()
    @IsNotEmpty()
    storeId: string;

    @IsOptional()
    @IsString()
    warehouseId?: string;

    @IsOptional()
    @IsString()
    customerId?: string;

    @IsOptional()
    @IsString()
    counterId?: string;

    @IsOptional()
    @IsString()
    referenceNumber?: string; // User-editable reference number

    @IsNumber()
    totalAmount: number;

    @IsNumber()
    amountPaid: number;

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSaleItemDto)
    items: CreateSaleItemDto[];

    /** Optional when the full balance is kept as customer due (credit sale). */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreatePaymentDto)
    payments?: CreatePaymentDto[];

    @IsOptional()
    @IsString()
    note?: string;

    /** Optional promo/discount code amount already applied on the client */
    @IsOptional()
    @IsNumber()
    discountAmount?: number;

    /** Loyalty points the customer wants to redeem on this sale */
    @IsOptional()
    @IsNumber()
    pointsToRedeem?: number;
}

export class UpdateSaleItemDto {
    @IsString()
    @IsNotEmpty()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    priceAtSale: number;

    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    serialNumbers?: string[];
}

export class UpdatePaymentDto {
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    @IsNumber()
    amount: number;

    @IsOptional()
    @IsString()
    accountId?: string;
}

export class UpdateSaleDto {
    @IsOptional()
    @IsString()
    customerId?: string | null;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    @IsString()
    note?: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdateSaleItemDto)
    items?: UpdateSaleItemDto[];

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => UpdatePaymentDto)
    payments?: UpdatePaymentDto[];
}

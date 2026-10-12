import { IsBoolean, IsString, IsArray, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { InlineCustomerDto } from '../customers/customer.dto';

export class CreateSalesOrderItemDto {
    @IsString()
    productId: string;

    @IsNumber()
    quantity: number;

    @IsNumber()
    priceAtOrder: number;
}

export class CreateSalesOrderDto {
    @IsString()
    storeId: string;

    @IsOptional()
    @IsString()
    customerId?: string;

    /** Quick-created customer, saved with the order. See `InlineCustomerDto`. */
    @IsOptional()
    @ValidateNested()
    @Type(() => InlineCustomerDto)
    newCustomer?: InlineCustomerDto;

    @IsArray()
    items: CreateSalesOrderItemDto[];

    @IsNumber()
    totalAmount: number;

    /**
     * False when the lines were typed before VAT and `vatAmount` was added on
     * top (and is part of `totalAmount`). Left out, the order is VAT-inclusive.
     */
    @IsOptional()
    @IsBoolean()
    pricesIncludeVat?: boolean;

    /** VAT added on top of the lines; part of `totalAmount`. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    vatAmount?: number;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    deliveryDate?: Date;
}

export class UpdateSalesOrderDto {
    @IsOptional()
    @IsString()
    customerId?: string;

    @IsOptional()
    @IsString()
    status?: string;

    @IsOptional()
    deliveryDate?: Date;

    @IsOptional()
    @IsArray()
    items?: CreateSalesOrderItemDto[];

    @IsOptional()
    @IsNumber()
    totalAmount?: number;

    /** VAT added on top of the lines; the order keeps the mode it was made in. */
    @IsOptional()
    @IsNumber()
    @Min(0)
    vatAmount?: number;
}

export class UpdateOrderStatusDto {
    @IsString()
    status: string;
}

export class AddDepositDto {
    @IsNumber()
    amount: number;

    @IsString()
    paymentMethod: string;
}

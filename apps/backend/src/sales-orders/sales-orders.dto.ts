import { IsString, IsArray, IsNumber, IsOptional, ValidateNested } from 'class-validator';
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

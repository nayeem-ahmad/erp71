import { IsString, IsOptional, IsEmail, IsEnum, IsUUID, IsNumber, IsBoolean, IsDateString, Min, Max, Matches } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export enum CustomerPaymentDirectionDto {
    RECEIVE = 'receive',
    PAY = 'pay',
}

export enum CustomerTypeDto {
    INDIVIDUAL = 'INDIVIDUAL',
    ORGANIZATION = 'ORGANIZATION',
}

export class CreateCustomerDto {
    @IsString()
    name: string;

    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    profile_pic_url?: string;

    @IsOptional()
    @IsEnum(CustomerTypeDto)
    customer_type?: CustomerTypeDto;

    @IsOptional()
    @IsUUID()
    customer_group_id?: string;

    @IsOptional()
    @IsUUID()
    territory_id?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    credit_limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsString()
    nid?: string;

    @IsOptional()
    @IsBoolean()
    credit_enabled?: boolean;

    @IsOptional()
    @IsString()
    preferred_channel?: string;

    @IsOptional()
    @IsDateString()
    birthday?: string;

    @IsOptional()
    @IsDateString()
    anniversary?: string;
}

export class UpdateCustomerDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\+?[0-9\s\-]+$/, { message: 'Invalid phone number format' })
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    profile_pic_url?: string;

    @IsOptional()
    @IsEnum(CustomerTypeDto)
    customer_type?: CustomerTypeDto;

    @IsOptional()
    @IsUUID()
    customer_group_id?: string;

    @IsOptional()
    @IsUUID()
    territory_id?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    credit_limit?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    default_discount_pct?: number;

    @IsOptional()
    @IsString()
    nid?: string;

    @IsOptional()
    @IsBoolean()
    credit_enabled?: boolean;

    @IsOptional()
    @IsString()
    preferred_channel?: string;

    @IsOptional()
    @IsDateString()
    birthday?: string;

    @IsOptional()
    @IsDateString()
    anniversary?: string;
}

export class RecordCreditPaymentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateCreditPaymentDto {
    @IsOptional()
    @IsNumber()
    @Min(0.01)
    amount?: number;

    @IsOptional()
    @IsEnum(CustomerPaymentDirectionDto)
    direction?: CustomerPaymentDirectionDto;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListCustomerCreditPaymentsQueryDto extends PaginationDto {
    @IsOptional()
    @IsUUID()
    customerId?: string;

    @IsOptional()
    @IsDateString()
    from?: string;

    @IsOptional()
    @IsDateString()
    to?: string;

    @IsOptional()
    @IsString()
    search?: string;
}

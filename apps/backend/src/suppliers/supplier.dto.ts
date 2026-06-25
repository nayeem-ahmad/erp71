import { IsEmail, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateSupplierDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;
}

export class UpdateSupplierDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    address?: string;
}

export class RecordSupplierCreditPaymentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsString()
    notes?: string;
}
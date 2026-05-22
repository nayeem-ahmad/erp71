import { IsString, IsNotEmpty, IsOptional, IsDateString, MaxLength, IsEnum } from 'class-validator';

export class CreateDeliveryDto {
    @IsOptional()
    @IsString()
    saleId?: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    customerName: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    customerPhone?: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(500)
    deliveryAddress: string;

    @IsOptional()
    @IsString()
    @MaxLength(200)
    driverName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    driverPhone?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;

    @IsOptional()
    @IsDateString()
    scheduledAt?: string;
}

export class UpdateDeliveryDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    driverName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    driverPhone?: string;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    deliveryAddress?: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    notes?: string;

    @IsOptional()
    @IsDateString()
    scheduledAt?: string;

    @IsOptional()
    @IsEnum(['PENDING', 'IN_TRANSIT', 'DELIVERED', 'FAILED', 'CANCELLED'])
    status?: string;
}

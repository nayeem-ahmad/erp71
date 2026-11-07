import { IsString, IsNotEmpty, IsOptional, IsDateString, MaxLength, IsEnum } from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

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

/**
 * The query behind the delivery list and the stats strip above it. Every key is
 * declared because the global ValidationPipe runs with `forbidNonWhitelisted`.
 * Deliveries are the tenant's, not a branch's, so there is no `storeId`.
 */
export class DeliveryListQueryDto extends PaginationDto {
    @IsOptional()
    @IsString()
    search?: string;

    /** One status or a comma-separated set. */
    @IsOptional()
    @IsString()
    status?: string;

    /** `true`: every status but those in `status`. */
    @IsOptional()
    @IsString()
    statusExclude?: string;

    /** Comma-separated driver names; `none` is a delivery with no driver yet. */
    @IsOptional()
    @IsString()
    driver?: string;

    /** The scheduled day, `YYYY-MM-DD[THH:mm]`. */
    @IsOptional()
    @IsString()
    dateFrom?: string;

    @IsOptional()
    @IsString()
    dateTo?: string;

    @IsOptional()
    @IsString()
    createdFrom?: string;

    @IsOptional()
    @IsString()
    createdTo?: string;

    @IsOptional()
    @IsString()
    sortBy?: string;

    @IsOptional()
    @IsString()
    sortDir?: string;
}

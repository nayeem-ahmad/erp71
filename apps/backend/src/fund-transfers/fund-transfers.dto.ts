import { Type } from 'class-transformer';
import {
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator';

const FUND_TRANSFER_METHODS = ['CASH', 'CHECK', 'BANK_TRANSFER'] as const;
const FUND_TRANSFER_STATUSES = ['INITIATED', 'IN_TRANSIT', 'RECEIVED', 'CANCELLED'] as const;

export class InitiateFundTransferDto {
    @IsUUID()
    sourceStoreId: string;

    @IsUUID()
    destinationStoreId: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsString()
    @IsIn(FUND_TRANSFER_METHODS)
    method?: typeof FUND_TRANSFER_METHODS[number];

    @IsOptional()
    @IsString()
    description?: string;
}

export class ListFundTransfersQueryDto {
    @IsOptional()
    @IsString()
    @IsIn(FUND_TRANSFER_STATUSES)
    status?: typeof FUND_TRANSFER_STATUSES[number];

    @IsOptional()
    @IsUUID()
    sourceStoreId?: string;

    @IsOptional()
    @IsUUID()
    destinationStoreId?: string;
}
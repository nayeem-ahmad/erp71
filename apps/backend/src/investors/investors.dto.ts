import {
    IsDateString,
    IsEmail,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
} from 'class-validator';
import { PaginationDto } from '../common/pagination.dto';

export const INVESTOR_STATUSES = ['ACTIVE', 'EXITED'] as const;
export const CAPITAL_DIRECTIONS = ['CONTRIBUTION', 'WITHDRAWAL'] as const;
export const PROFIT_BASIS_TYPES = ['NET_PROFIT'] as const;

export class CreateInvestorDto {
    @IsString()
    @MaxLength(200)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    nationalId?: string;

    @IsNumber()
    @Min(0.01)
    @Max(100)
    profitSharePct: number;

    @IsDateString()
    joinedOn: string;

    /** Omit for a company-wide investor; set to tie the share to one branch's profit. */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateInvestorDto {
    @IsOptional()
    @IsString()
    @MaxLength(200)
    name?: string;

    @IsOptional()
    @IsString()
    @MaxLength(30)
    phone?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    nationalId?: string;

    @IsOptional()
    @IsNumber()
    @Min(0.01)
    @Max(100)
    profitSharePct?: number;

    @IsOptional()
    @IsDateString()
    joinedOn?: string;

    @IsOptional()
    @IsDateString()
    exitedOn?: string | null;

    @IsOptional()
    @IsUUID()
    storeId?: string | null;

    @IsOptional()
    @IsIn(INVESTOR_STATUSES)
    status?: (typeof INVESTOR_STATUSES)[number];

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListInvestorsQueryDto extends PaginationDto {
    @IsOptional()
    @IsIn(INVESTOR_STATUSES)
    status?: (typeof INVESTOR_STATUSES)[number];

    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsString()
    search?: string;
}

export class CreateCapitalTxnDto {
    @IsOptional()
    @IsIn(CAPITAL_DIRECTIONS)
    direction?: (typeof CAPITAL_DIRECTIONS)[number];

    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsDateString()
    txnDate: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    @MaxLength(100)
    reference?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ProfitRunDto {
    @IsInt()
    @Min(2000)
    @Max(2100)
    year: number;

    @IsInt()
    @Min(1)
    @Max(12)
    month: number;

    /** Scope the run to one branch's profit. Omit for a company-wide run. */
    @IsOptional()
    @IsUUID()
    storeId?: string;

    @IsOptional()
    @IsIn(PROFIT_BASIS_TYPES)
    basisType?: (typeof PROFIT_BASIS_TYPES)[number];

    @IsOptional()
    @IsString()
    notes?: string;
}

export class ListProfitRunsQueryDto extends PaginationDto {
    @IsOptional()
    @IsInt()
    @Min(2000)
    @Max(2100)
    year?: number;

    @IsOptional()
    @IsUUID()
    storeId?: string;
}

export class PayProfitShareDto {
    @IsDateString()
    paymentDate: string;

    @IsOptional()
    @IsString()
    @MaxLength(50)
    paymentMethod?: string;

    @IsOptional()
    @IsString()
    notes?: string;
}

import { IsBoolean, IsEmail, IsNumber, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateRefereeDto {
    @IsString()
    name: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsNumber()
    @Min(0)
    @Max(100)
    commission_rate: number;

    @IsNumber()
    @Min(0)
    @Max(100)
    signup_discount: number;

    @IsOptional()
    @IsString()
    notes?: string;
}

export class UpdateRefereeDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsEmail()
    email?: string;

    @IsOptional()
    @IsString()
    phone?: string;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    commission_rate?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Max(100)
    signup_discount?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString()
    @Matches(/^[A-Za-z0-9]{4,20}$/, { message: 'Referral code must be 4–20 letters or digits' })
    referral_code?: string;
}

export class RecordPaymentDto {
    @IsNumber()
    @Min(0.01)
    amount: number;

    @IsOptional()
    @IsString()
    method?: string;

    @IsOptional()
    @IsString()
    reference?: string;

    @IsOptional()
    @IsString()
    notes?: string;

    @IsOptional()
    @IsString({ each: true })
    commission_ids?: string[];
}

export class ListCommissionsQueryDto {
    @IsOptional()
    @IsString()
    referee_id?: string;

    @IsOptional()
    @IsString()
    status?: 'PENDING' | 'EARNED' | 'PAID';
}

import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const SUPPORTED_LOCALES = ['en', 'bn', 'ms'] as const;

export class SignupDto {
    @IsEmail({}, { message: 'Please enter a valid email address.' })
    email: string;

    @IsString()
    @MinLength(8, { message: 'Password must be at least 8 characters.' })
    password: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString({ message: 'Organization name is required.' })
    tenantName: string;

    @IsString({ message: 'Store name is required.' })
    storeName: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsIn(['BASIC', 'ACCOUNTING', 'STANDARD', 'PREMIUM'])
    planCode?: 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';

    @IsOptional()
    @IsString()
    referralCode?: string;
}

export class LoginDto {
    @IsEmail()
    email: string;

    @IsString()
    password: string;
}

export class CreateStoreDto {
    tenantName?: string;
    name: string;
    address?: string;
    @IsOptional()
    @IsIn(['BASIC', 'ACCOUNTING', 'STANDARD', 'PREMIUM'])
    planCode?: 'BASIC' | 'ACCOUNTING' | 'STANDARD' | 'PREMIUM';
    businessType?: string;
}

export class UpdateProfileDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsIn(SUPPORTED_LOCALES)
    preferred_locale?: (typeof SUPPORTED_LOCALES)[number];
}

export class ChangePasswordDto {
    currentPassword: string;
    newPassword: string;
}

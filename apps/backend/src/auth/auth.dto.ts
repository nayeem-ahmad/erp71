import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

const SUPPORTED_LOCALES = ['en', 'bn', 'ms'] as const;

export class SignupDto {
    @IsEmail()
    email: string;

    @IsString()
    @MinLength(8)
    password: string;

    @IsOptional()
    @IsString()
    name?: string;

    @IsString()
    tenantName: string;

    @IsString()
    storeName: string;

    @IsOptional()
    @IsString()
    address?: string;

    @IsOptional()
    @IsString()
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
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
    planCode?: 'FREE' | 'BASIC' | 'STANDARD' | 'PREMIUM';
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

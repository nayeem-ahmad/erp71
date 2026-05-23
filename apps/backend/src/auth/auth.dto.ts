import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

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
}

export class UpdateProfileDto {
    name?: string;
}

export class ChangePasswordDto {
    currentPassword: string;
    newPassword: string;
}

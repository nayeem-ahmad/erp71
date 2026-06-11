import { IsEmail, IsObject, IsOptional, IsString } from 'class-validator';

export class UpsertGroupSettingsDto {
    @IsObject()
    settings: Record<string, string | null>;
}

export class TestSmsDto {
    @IsString()
    phone: string;
}

export class TestEmailDto {
    @IsOptional()
    @IsEmail()
    email?: string;
}

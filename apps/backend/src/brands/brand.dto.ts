import { IsOptional, IsString, IsUrl } from 'class-validator';

export class CreateBrandDto {
    @IsString()
    name: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    logo_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;
}

export class UpdateBrandDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    description?: string;

    @IsOptional()
    @IsString()
    logo_url?: string;

    @IsOptional()
    @IsString()
    website_url?: string;
}

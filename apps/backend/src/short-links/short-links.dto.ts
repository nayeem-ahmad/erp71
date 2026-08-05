import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateShortLinkDto {
    @IsString()
    @MinLength(1)
    @MaxLength(2048)
    target_url!: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    label?: string;
}

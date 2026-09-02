import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateStoreDto {
    @IsString({ message: 'Store name is required.' })
    @MinLength(1, { message: 'Store name is required.' })
    @MaxLength(100)
    name: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    address?: string;
}

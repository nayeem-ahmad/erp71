import { IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateStoreDto {
    @IsString({ message: 'Store name is required.' })
    @MinLength(1, { message: 'Store name is required.' })
    @MaxLength(100)
    name: string;
}

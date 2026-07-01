import { Type } from 'class-transformer';
import {
    IsArray,
    IsBoolean,
    IsNumber,
    IsOptional,
    IsString,
    ValidateNested,
} from 'class-validator';

class NavLayoutNodeDto {
    @IsString()
    id!: string;

    @IsOptional()
    @IsString()
    parentId!: string | null;

    @IsNumber()
    sortOrder!: number;

    @IsBoolean()
    visible!: boolean;
}

export class SaveNavLayoutDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => NavLayoutNodeDto)
    layout!: NavLayoutNodeDto[];
}
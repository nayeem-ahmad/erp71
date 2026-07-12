import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CustomFieldInput {
  @IsOptional()
  @IsString()
  key?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(40)
  label: string;

  @IsOptional()
  @IsInt()
  order?: number;
}

export class SaveCustomFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldInput)
  fields: CustomFieldInput[];
}

export interface CustomFieldDefinitionDto {
  key: string;
  label: string;
  order: number;
}

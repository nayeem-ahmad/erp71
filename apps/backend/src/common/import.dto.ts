import { IsArray, IsEnum, ArrayMaxSize } from 'class-validator';

export class ImportRowsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  rows: Record<string, unknown>[];

  @IsEnum(['skip', 'upsert'])
  mode: 'skip' | 'upsert';
}

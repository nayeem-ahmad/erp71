import { IsArray, IsEnum } from 'class-validator';

export class ImportRowsDto {
  @IsArray()
  rows: Record<string, unknown>[];

  @IsEnum(['skip', 'upsert'])
  mode: 'skip' | 'upsert';
}

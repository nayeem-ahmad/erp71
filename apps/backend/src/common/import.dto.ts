import { IsOptional, IsString, IsArray, IsEnum, ArrayMaxSize } from 'class-validator';

export class ImportRowsDto {
  @IsArray()
  @ArrayMaxSize(5000)
  rows: Record<string, unknown>[];

  @IsEnum(['skip', 'upsert'])
  mode: 'skip' | 'upsert';

  /**
   * Customer and supplier imports: the branch rows without a `branch` column
   * go to. Omitted: the request's header branch. Other importers ignore it.
   */
  @IsOptional()
  @IsString()
  storeId?: string;
}

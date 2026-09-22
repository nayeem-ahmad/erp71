import { IsUUID, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class OpenSessionDto {
  @IsUUID()
  storeId: string;

  /** Opening float in the drawer, reconciled against the count at close. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  openingCash: number;

  /** Omitted for a sessionless till; a counter holds one open session. */
  @IsOptional()
  @IsUUID()
  counterId?: string;
}

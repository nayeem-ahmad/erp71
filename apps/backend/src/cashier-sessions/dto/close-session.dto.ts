import { IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CloseSessionDto {
  /** Counted cash at close; `variance` is this less `expected_cash`. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  closingCash: number;
}

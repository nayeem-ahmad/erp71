import { IsNumber, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Mirrors the `type` values documented on CashTransaction. PAYOUT and LOAN
 * move cash out of the till and post to the GL; DROP and OTHER do not.
 */
export const CASH_TRANSACTION_TYPES = ['DROP', 'LOAN', 'PAYOUT', 'OTHER'] as const;

export class CashTransactionDto {
  /** Signed: positive is cash in, negative is cash out. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  amount: number;

  @IsIn(CASH_TRANSACTION_TYPES)
  type: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;
}

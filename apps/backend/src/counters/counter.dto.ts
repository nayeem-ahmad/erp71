import { IsString, IsOptional, IsUUID, IsInt, IsIn, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export const COUNTER_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

export class CreateCounterDto {
  @IsUUID()
  storeId: string;

  @IsString()
  @MaxLength(60)
  name: string;

  /** Unique per store; the service rejects a number already taken. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  counterNumber: number;
}

export class UpdateCounterDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsIn(COUNTER_STATUSES)
  status?: string;
}

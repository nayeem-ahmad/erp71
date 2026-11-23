import { Transform, Type } from 'class-transformer';
import {
    IsBoolean,
    IsIn,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Matches,
    MaxLength,
    Max,
    Min,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import { CHEQUE_DIRECTIONS, CHEQUE_STATUSES, type ChequeDirection, type ChequeStatus } from '@erp71/shared-types';

const trimmed = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
    value === '' || value === null ? undefined : typeof value === 'string' ? value.trim() : value;

/** A calendar day as the form sends it. The cheque's date is a day, not an instant. */
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateChequeDto {
    @IsIn(CHEQUE_DIRECTIONS)
    direction!: ChequeDirection;

    @Transform(trimmed)
    @IsString()
    @IsNotEmpty()
    @MaxLength(120)
    bankName!: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(120)
    branchName?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(40)
    accountNumber?: string;

    @Transform(trimmed)
    @IsString()
    @IsNotEmpty()
    @MaxLength(40)
    chequeNumber!: string;

    @Transform(trimmed)
    @IsString()
    @IsNotEmpty()
    @MaxLength(200)
    partyName!: string;

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    @Max(999_999_999_999)
    amount!: number;

    @Matches(CALENDAR_DAY, { message: 'chequeDate must be a date (YYYY-MM-DD)' })
    chequeDate!: string;

    @IsOptional()
    @IsBoolean()
    accountPayee?: boolean;

    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(500)
    memo?: string;

    @IsOptional()
    @IsIn(CHEQUE_STATUSES)
    status?: ChequeStatus;
}

export class UpdateChequeDto extends PartialType(CreateChequeDto) {}

export class ListChequesQueryDto {
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn(CHEQUE_DIRECTIONS)
    direction?: ChequeDirection;

    /** One status, or `open` for PENDING and DEPOSITED together. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsIn([...CHEQUE_STATUSES, 'open'])
    status?: ChequeStatus | 'open';

    @IsOptional()
    @Transform(emptyToUndefined)
    @Matches(CALENDAR_DAY)
    from?: string;

    @IsOptional()
    @Transform(emptyToUndefined)
    @Matches(CALENDAR_DAY)
    to?: string;

    /** Party, cheque number or bank, case-insensitively. */
    @IsOptional()
    @Transform(emptyToUndefined)
    @IsString()
    @MaxLength(100)
    search?: string;
}

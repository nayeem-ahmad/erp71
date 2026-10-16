import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import { MESSAGING_CHANNELS, type MessagingChannel } from '../sms/messaging-channel';

export const CREDIT_TOPUP_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CreditTopupStatus = (typeof CREDIT_TOPUP_STATUSES)[number];

/** A shop telling us it has sent the bKash payment for a package. */
export class CreateCreditTopupRequestDto {
    @IsString()
    packageId!: string;

    /**
     * The bKash TrxID from the payment confirmation SMS. Letters and digits
     * only, and bounded: it is matched by eye against the bKash app, and
     * anything longer is a paste accident rather than a receipt.
     */
    @IsString()
    @Matches(/^\s*[A-Za-z0-9]{6,32}\s*$/, { message: 'Enter the bKash TrxID exactly as it appears in the payment SMS.' })
    transactionId!: string;

    /** The bKash number the money was sent from. */
    @IsString()
    @Matches(/^\s*\+?[0-9][0-9\s-]{7,18}\s*$/, { message: 'Enter the bKash number you paid from.' })
    senderNumber!: string;

    @IsOptional()
    @IsString()
    @Length(0, 500)
    note?: string;
}

export class ListCreditTopupRequestsDto {
    @IsOptional()
    @IsIn(CREDIT_TOPUP_STATUSES as unknown as string[])
    status?: CreditTopupStatus;
}

export class ApproveCreditTopupRequestDto {
    /**
     * What the admin found in the bKash app, which is what reaches the ledger.
     * Omitted means "the package price the shop was asked for arrived".
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    amount?: number;

    /** Credits to grant. Omitted means the package's credits. */
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(10_000_000)
    credits?: number;

    @IsOptional()
    @IsString()
    @Length(0, 500)
    note?: string;
}

export class RejectCreditTopupRequestDto {
    /**
     * Shown to the shop verbatim, on its credits screen and in the support
     * ticket, so it is required: "rejected" with no reason gives them nothing
     * to fix.
     */
    @IsString()
    @Length(3, 500)
    reason!: string;
}

export class CreateCreditPackageDto {
    @IsIn(MESSAGING_CHANNELS as unknown as string[])
    channel!: MessagingChannel;

    @IsString()
    @Length(2, 120)
    name!: string;

    @IsInt()
    @Min(1)
    credits!: number;

    @IsNumber()
    @Min(0)
    price!: number;

    @IsOptional()
    @IsInt()
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

export class UpdateCreditPackageDto {
    @IsOptional()
    @IsString()
    @Length(2, 120)
    name?: string;

    @IsOptional()
    @IsInt()
    @Min(1)
    credits?: number;

    @IsOptional()
    @IsNumber()
    @Min(0)
    price?: number;

    @IsOptional()
    @IsInt()
    sort_order?: number;

    @IsOptional()
    @IsBoolean()
    is_active?: boolean;
}

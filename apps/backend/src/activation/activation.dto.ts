import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

/**
 * How a tenant can pay for its first period while no gateway is live. Plain
 * strings rather than a Prisma enum: the set changes with which merchant
 * accounts the team holds, which is a business fact, not a schema one.
 */
export const ACTIVATION_PAYMENT_METHODS = ['BKASH', 'NAGAD', 'BANK_TRANSFER'] as const;
export type ActivationPaymentMethod = (typeof ACTIVATION_PAYMENT_METHODS)[number];

export class CreateActivationRequestDto {
    @IsIn(ACTIVATION_PAYMENT_METHODS as unknown as string[])
    method!: ActivationPaymentMethod;

    /**
     * The bKash/Nagad TrxID or bank reference. Bounded rather than free-form:
     * this is matched by eye against a merchant app, and a 2,000-character
     * "reference" is a paste accident, not a receipt.
     */
    @IsString()
    @Length(4, 64)
    transactionId!: string;

    @IsOptional()
    @IsString()
    @Length(4, 32)
    senderNumber?: string;

    @IsNumber()
    @Min(1)
    amount!: number;

    @IsOptional()
    @IsString()
    @Length(0, 500)
    note?: string;
}

export class ReviewActivationRequestDto {
    /**
     * What the admin actually found in the merchant app, which is what reaches
     * the ledger. Omitted means "the amount the tenant claimed is correct".
     */
    @IsOptional()
    @IsNumber()
    @Min(0)
    amount?: number;

    @IsOptional()
    @IsString()
    @Length(0, 500)
    note?: string;
}

export class RejectActivationRequestDto {
    /**
     * Shown to the tenant verbatim, so it is required: "rejected" with no reason
     * sends them back to a form with nothing to change.
     */
    @IsString()
    @Length(3, 500)
    reason!: string;
}

export class ListActivationRequestsDto {
    @IsOptional()
    @IsIn(['PENDING', 'VERIFIED', 'REJECTED'])
    status?: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

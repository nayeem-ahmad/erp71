import { Transform } from 'class-transformer';
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * A cleared date box. `@IsOptional` only lets `null` and `undefined` through,
 * so without this an operator who typed a cheque date and then deleted it sent
 * `''` and had the whole document refused as "not a valid ISO 8601 date".
 */
const emptyToUndefined = ({ value }: { value: unknown }) => (value === '' ? undefined : value);

/**
 * The instrument a non-cash payment was made on — the cheque, the transfer, the
 * card slip or the wallet receipt. Every field is optional and every one is free
 * text: the shop is recording what is written on a piece of paper, not selecting
 * from anything the system knows about.
 *
 * Shared by the payment bodies of a sale (money in) and a purchase (money out),
 * which is why it lives here rather than with either. The entry form relabels
 * the fields per tender — a cheque's number, a transfer's reference and a
 * wallet's transaction id all land in `referenceNo` — so one set covers all of
 * them. `accountId` on the sale's payment bodies is a different thing: the
 * *ledger* account the payment posts to.
 */
export class PaymentInstrumentDto {
    /** The bank a cheque is drawn on, or the card's issuer. */
    @IsOptional()
    @IsString()
    @MaxLength(120)
    bankName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    bankBranch?: string;

    /** The account or wallet number on the cheque or transfer, as written. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    bankAccountNumber?: string;

    /** Cheque number, wallet transaction id, or card approval code. */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    referenceNo?: string;

    /**
     * The date on the instrument — `YYYY-MM-DD` from the entry form's date
     * box. Routinely later than the document's own date: a post-dated cheque is
     * an ordinary way to pay and be paid here.
     */
    @Transform(emptyToUndefined)
    @IsOptional()
    @IsDateString()
    instrumentDate?: string;
}

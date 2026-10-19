import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { PaymentInstrumentDto } from './payment-instrument.dto';

/**
 * One tender money moved by on a return: what a sales return refunded the
 * customer with, or what a purchase return got back from the supplier. Split
 * across methods by sending several. What the tenders leave of the return's
 * total is settled against the party's due instead.
 *
 * The instrument details it inherits are the same ones a sale or a purchase
 * payment records — see `PaymentInstrumentDto`.
 */
export class ReturnPaymentDto extends PaymentInstrumentDto {
    /** The canonical type string (Cash, Bank, Mobile Wallet, Card). */
    @IsString()
    @IsNotEmpty()
    paymentMethod: string;

    /**
     * The tenant's payment method picked on the return. The server resolves its
     * linked account and checks it is offered at the return's branch. Absent,
     * the method is matched by name.
     */
    @IsOptional()
    @IsString()
    paymentMethodId?: string;

    @IsNumber()
    @Min(0)
    amount: number;
}

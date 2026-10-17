import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsCreditService } from './sms-credit.service';

/**
 * Sending SMS and the prepaid messaging balances every metered channel spends.
 * Global because SMS, WhatsApp and email all bill through SmsCreditService.
 * The tenant-facing credits screen and the admin top-up queue live in
 * CreditTopupsModule.
 */
@Global()
@Module({
    providers: [SmsService, SmsCreditService],
    exports: [SmsService, SmsCreditService],
})
export class SmsModule {}

import { Global, Module } from '@nestjs/common';
import { SmsService } from './sms.service';
import { SmsCreditService } from './sms-credit.service';
import { SmsCreditController } from './sms-credit.controller';

@Global()
@Module({
    controllers: [SmsCreditController],
    providers: [SmsService, SmsCreditService],
    exports: [SmsService, SmsCreditService],
})
export class SmsModule {}

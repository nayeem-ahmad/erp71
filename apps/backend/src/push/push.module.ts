import { Global, Module } from '@nestjs/common';
import { FcmSender } from './fcm-sender';
import { PushController } from './push.controller';
import { PushService } from './push.service';

/** Global so any module that writes a notification can push it. */
@Global()
@Module({
    controllers: [PushController],
    providers: [PushService, FcmSender],
    exports: [PushService],
})
export class PushModule {}

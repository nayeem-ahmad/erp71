import { Global, Module } from '@nestjs/common';
import { EncryptionService } from './encryption.service';
import { AppLogger } from './app-logger.service';

@Global()
@Module({
    providers: [EncryptionService, AppLogger],
    exports: [EncryptionService, AppLogger],
})
export class CommonModule {}

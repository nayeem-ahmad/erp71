import { Module } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetController } from './password-reset.controller';

@Module({
    providers: [PasswordResetService],
    controllers: [PasswordResetController],
    exports: [PasswordResetService],
})
export class PasswordResetModule {}

import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { ContactController } from './contact.controller';

@Module({
    imports: [EmailModule],
    controllers: [ContactController],
})
export class ContactModule {}

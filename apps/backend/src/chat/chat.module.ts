import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { DatabaseModule } from '../database/database.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChatController } from './chat.controller';
import { ChatAccessService } from './chat-access.service';
import { ChatAttachmentsService } from './chat-attachments.service';
import { ChatService } from './chat.service';

@Module({
    imports: [DatabaseModule, NotificationsModule, AssetsModule],
    controllers: [ChatController],
    providers: [ChatService, ChatAccessService, ChatAttachmentsService],
    exports: [ChatService],
})
export class ChatModule {}

import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    UseGuards,
    UseInterceptors,
} from '@nestjs/common';
import { StorePermission } from '@erp71/shared-types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RequireStorePermission } from '../auth/store-permission.decorator';
import { StorePermissionGuard } from '../auth/store-permission.guard';
import { RequiresFeature } from '../auth/subscription-access.decorator';
import { SubscriptionAccessGuard } from '../auth/subscription-access.guard';
import { Tenant, TenantContext } from '../database/tenant.decorator';
import { TenantInterceptor } from '../database/tenant.interceptor';
import { ChatService } from './chat.service';
import {
    AddParticipantsDto,
    CreateConversationDto,
    EditMessageDto,
    ListMessagesDto,
    SendMessageDto,
    UpdateConversationDto,
} from './chat.dto';

/**
 * Private staff-to-staff messaging.
 *
 * `USE_TEAM_CHAT` gates the feature; it does *not* decide who may read a given
 * conversation. That is participant membership alone, checked in the service on
 * every call — including for OWNER, who bypasses the guard above but is not
 * thereby a member of anyone's DM. See ChatAccessService.
 */
@Controller('chat')
@UseGuards(JwtAuthGuard, StorePermissionGuard, SubscriptionAccessGuard)
@RequiresFeature('teamChat')
@RequireStorePermission(StorePermission.USE_TEAM_CHAT)
@UseInterceptors(TenantInterceptor)
export class ChatController {
    constructor(private readonly chat: ChatService) {}

    // Declared before the `:id` routes below — Nest matches in declaration
    // order, so a parameterised route would otherwise swallow these as ids.
    @Get('unread-count')
    unreadCount(@Tenant() tenant: TenantContext) {
        return this.chat.unreadCount(this.viewer(tenant));
    }

    @Get('directory')
    directory(@Tenant() tenant: TenantContext) {
        return this.chat.directory(this.viewer(tenant));
    }

    @Get('conversations')
    listConversations(@Tenant() tenant: TenantContext) {
        return this.chat.listConversations(this.viewer(tenant));
    }

    @Post('conversations')
    createConversation(@Tenant() tenant: TenantContext, @Body() dto: CreateConversationDto) {
        return this.chat.createConversation(this.viewer(tenant), dto);
    }

    @Get('conversations/:id')
    getConversation(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.chat.getConversation(this.viewer(tenant), id);
    }

    @Patch('conversations/:id')
    updateConversation(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: UpdateConversationDto,
    ) {
        return this.chat.updateConversation(this.viewer(tenant), id, dto);
    }

    @Get('conversations/:id/messages')
    listMessages(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Query() query: ListMessagesDto,
    ) {
        return this.chat.listMessages(this.viewer(tenant), id, query);
    }

    @Post('conversations/:id/messages')
    sendMessage(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: SendMessageDto,
    ) {
        return this.chat.sendMessage(this.viewer(tenant), id, dto);
    }

    @Post('conversations/:id/read')
    markRead(@Tenant() tenant: TenantContext, @Param('id') id: string) {
        return this.chat.markRead(this.viewer(tenant), id);
    }

    @Post('conversations/:id/participants')
    addParticipants(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Body() dto: AddParticipantsDto,
    ) {
        return this.chat.addParticipants(this.viewer(tenant), id, dto);
    }

    @Delete('conversations/:id/participants/:userId')
    removeParticipant(
        @Tenant() tenant: TenantContext,
        @Param('id') id: string,
        @Param('userId') userId: string,
    ) {
        return this.chat.removeParticipant(this.viewer(tenant), id, userId);
    }

    @Patch('messages/:messageId')
    editMessage(
        @Tenant() tenant: TenantContext,
        @Param('messageId') messageId: string,
        @Body() dto: EditMessageDto,
    ) {
        return this.chat.editMessage(this.viewer(tenant), messageId, dto);
    }

    @Delete('messages/:messageId')
    deleteMessage(@Tenant() tenant: TenantContext, @Param('messageId') messageId: string) {
        return this.chat.deleteMessage(this.viewer(tenant), messageId);
    }

    private viewer(tenant: TenantContext) {
        return { tenantId: tenant.tenantId, userId: tenant.userId };
    }
}

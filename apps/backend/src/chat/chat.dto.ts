import { Type } from 'class-transformer';
import {
    ArrayMaxSize,
    IsArray,
    IsBoolean,
    IsIn,
    IsInt,
    IsOptional,
    IsString,
    MaxLength,
    Min,
    MinLength,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import {
    MAX_CHAT_ATTACHMENTS_PER_MESSAGE,
    MAX_CHAT_MESSAGE_LENGTH,
    MAX_GROUP_PARTICIPANTS,
} from './chat.util';

export class ChatAttachmentUploadDto {
    @IsString()
    fileBase64: string;

    @IsOptional()
    @IsString()
    @MaxLength(255)
    fileName?: string;

    @IsOptional()
    @IsString()
    @MaxLength(120)
    mimeType?: string;
}

export class CreateConversationDto {
    @IsIn(['dm', 'group'])
    kind: 'dm' | 'group';

    /// Required for a group and ignored for a DM, whose title is always the
    /// other participant's name and therefore differs per viewer.
    @ValidateIf((dto: CreateConversationDto) => dto.kind === 'group')
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    title?: string;

    /// The other member for a DM (exactly one), or the initial members of a
    /// group. The caller is always added and never has to list themselves.
    @IsArray()
    @ArrayMaxSize(MAX_GROUP_PARTICIPANTS)
    @IsString({ each: true })
    participantIds: string[];
}

export class SendMessageDto {
    /// May be empty when attachments are present — a photo with no caption is a
    /// message. `assertSendable` in the service enforces "not both empty".
    @IsString()
    @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
    body: string;

    @IsOptional()
    @IsArray()
    @ArrayMaxSize(MAX_CHAT_ATTACHMENTS_PER_MESSAGE)
    @ValidateNested({ each: true })
    @Type(() => ChatAttachmentUploadDto)
    attachments?: ChatAttachmentUploadDto[];
}

export class EditMessageDto {
    @IsString()
    @MinLength(1)
    @MaxLength(MAX_CHAT_MESSAGE_LENGTH)
    body: string;
}

export class UpdateConversationDto {
    @IsOptional()
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    title?: string;

    @IsOptional()
    @IsBoolean()
    archived?: boolean;

    /// Minutes to silence notifications for. 0 clears the mute.
    @IsOptional()
    @IsInt()
    @Min(0)
    muteMinutes?: number;
}

export class AddParticipantsDto {
    @IsArray()
    @ArrayMaxSize(MAX_GROUP_PARTICIPANTS)
    @IsString({ each: true })
    participantIds: string[];
}

export class ListMessagesDto {
    /// Cursor: the id of the oldest message already held. Messages load newest
    /// first and scroll backwards, so paging is "before this one", not an
    /// offset — an offset would skip or repeat rows as new messages arrive.
    @IsOptional()
    @IsString()
    before?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number;
}

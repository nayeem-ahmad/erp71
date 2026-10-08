import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string;
}

/** A reason is required: the requester is the one who has to act on a "no". */
export class RejectDto {
    @IsString()
    @IsNotEmpty({ message: 'Say why, so the requester knows what to change.' })
    @MaxLength(500)
    reason: string;
}

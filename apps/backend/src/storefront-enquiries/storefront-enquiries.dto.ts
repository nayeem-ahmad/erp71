import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * What a visitor types into the enquiry form on a shop's storefront.
 *
 * Deliberately smaller than `CreateLeadDto`: a stranger on the public web is
 * given a name, a way to reach them and a message, and nothing that would let
 * them set a lead's priority, owner or status from outside the workspace.
 *
 * The lengths are upper bounds against a bot filling the tenant's CRM with
 * novels, not a house style — a real enquiry is a paragraph.
 */
export class StorefrontEnquiryDto {
    @IsString()
    @MinLength(1)
    @MaxLength(120)
    name: string;

    /**
     * Optional, but see `StorefrontEnquiriesService.submit`: an enquiry with
     * neither an email nor a mobile is refused there rather than here, because
     * the rule is "at least one of the two" and class-validator cannot say that
     * about a pair of fields without a custom constraint.
     */
    @IsOptional()
    @IsEmail({}, { message: 'Enter a valid email address.' })
    @MaxLength(180)
    email?: string;

    @IsOptional()
    @IsString()
    @MaxLength(32)
    mobile?: string;

    @IsString()
    @MinLength(10, { message: 'Tell us a little more — at least 10 characters.' })
    @MaxLength(2000)
    message: string;
}

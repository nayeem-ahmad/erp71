import { ValidateBy, ValidationOptions, isUUID } from 'class-validator';

/**
 * A branch filter value: a store id, or the literal `all` for every branch.
 * Replaces `@IsUUID()` on the `storeId` of branch-aware read DTOs. Whether the
 * caller may use the value is `BranchScopeService`'s job, not the validator's.
 */
export function IsStoreIdOrAll(validationOptions?: ValidationOptions): PropertyDecorator {
    return ValidateBy(
        {
            name: 'isStoreIdOrAll',
            validator: {
                validate: (value: unknown) => typeof value === 'string' && (value === 'all' || isUUID(value)),
                defaultMessage: () => '$property must be a branch id or "all"',
            },
        },
        validationOptions,
    );
}

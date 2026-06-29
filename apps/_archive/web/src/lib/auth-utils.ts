import { createClient } from "./supabase";
import { UserRole } from "@erp71/shared-types";

/**
 * Role priority for hierarchy checks.
 * Higher number means more permissions.
 */
const ROLE_PRIORITY: Record<UserRole, number> = {
  [UserRole.OWNER]: 4,
  [UserRole.MANAGER]: 3,
  [UserRole.ACCOUNTANT]: 2,
  [UserRole.CASHIER]: 1,
};

/**
 * Gets the role of a user for a specific tenant.
 */
export async function getUserRole(userId: string, tenantId: string): Promise<UserRole | null> {
  const supabase = await createClient();
  
  const { data, error } = await supabase
    .from("tenant_users")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;
  return data.role as UserRole;
}

/**
 * Checks if a user has at least the required role for a tenant.
 */
export async function hasRole(
  userId: string,
  tenantId: string,
  requiredRole: UserRole
): Promise<boolean> {
  const userRole = await getUserRole(userId, tenantId);
  if (!userRole) return false;

  return ROLE_PRIORITY[userRole] >= ROLE_PRIORITY[requiredRole];
}

/**
 * Server-side helper to enforce a role requirement.
 * Throws an error or redirects if the requirement isn't met.
 */
export async function requireRole(tenantId: string, requiredRole: UserRole) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new Error("Authentication required");
  }

  const authorized = await hasRole(user.id, tenantId, requiredRole);
  if (!authorized) {
    throw new Error("Unauthorized: Insufficient permissions");
  }

  return { user, tenantId };
}

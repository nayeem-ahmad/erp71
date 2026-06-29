import { describe, it, expect, vi } from "vitest";
import { getUserRole, hasRole } from "./auth-utils";
import { UserRole } from "@erp71/shared-types";

// Mock the supabase client
vi.mock("./supabase", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: { role: UserRole.MANAGER },
              error: null,
            })),
          })),
        })),
      })),
    })),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-123" } },
        error: null,
      })),
    },
  })),
}));

describe("auth-utils", () => {
  const userId = "user-123";
  const tenantId = "tenant-456";

  it("should return the user role for a tenant", async () => {
    const role = await getUserRole(userId, tenantId);
    expect(role).toBe(UserRole.MANAGER);
  });

  it("should correctly validate role hierarchy", async () => {
    // MANAGER (3) should have CASHIER (1) permissions
    const isAuthorized = await hasRole(userId, tenantId, UserRole.CASHIER);
    expect(isAuthorized).toBe(true);

    // MANAGER (3) should NOT have OWNER (4) permissions
    const isOwner = await hasRole(userId, tenantId, UserRole.OWNER);
    expect(isOwner).toBe(false);
  });
});

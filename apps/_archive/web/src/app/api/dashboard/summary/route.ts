import { createReadClient } from "@/lib/supabase";
import { NextResponse } from "next/server";
import { withErrorHandler } from "@/lib/api-utils";
import { requireRole } from "@/lib/auth-utils";
import { UserRole } from "@erp71/shared-types";

async function handler(req: Request) {
  // Try to extract tenantId from query params or headers for this example
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenantId");

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  // Ensure user has at least MANAGER access to view dashboard summaries
  await requireRole(tenantId, UserRole.MANAGER);

  // Use the Read Client for heavy analytical queries
  const supabase = await createReadClient();

  // Example "heavy" query: Count total stores and users for the tenant
  const [storesResult, usersResult] = await Promise.all([
    supabase.from("stores").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    supabase.from("tenant_users").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);

  if (storesResult.error) throw storesResult.error;
  if (usersResult.error) throw usersResult.error;

  return NextResponse.json({
    totalStores: storesResult.count || 0,
    totalUsers: usersResult.count || 0,
    timestamp: new Date().toISOString(),
  });
}

export const GET = withErrorHandler(handler);

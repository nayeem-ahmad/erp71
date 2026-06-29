"use server";

import { createClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { SignupSchema } from "@erp71/shared-types";
import { formatError } from "@/lib/api-utils";

export async function signup(formData: FormData) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const storeName = formData.get("storeName") as string;

  const requestId = Math.random().toString(36).substring(7);

  try {
    // 1. Zod Validation (AC 1.5.3)
    SignupSchema.parse({ email, password, storeName });

    const supabase = await createClient();

    // 2. Register User in Supabase Auth
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (authError || !authData.user) {
      throw authError || new Error("Auth registration failed");
    }

    const userId = authData.user.id;

    // 3. Create Tenant (Organization)
    const { data: tenantData, error: tenantError } = await supabase
      .from("tenants")
      .insert([{ name: storeName, owner_id: userId }])
      .select()
      .single();

    if (tenantError || !tenantData) {
      throw tenantError || new Error("Tenant creation failed");
    }

    const tenantId = tenantData.id;

    // 4. Create First Store for the Tenant
    const { error: storeError } = await supabase
      .from("stores")
      .insert([{ tenant_id: tenantId, name: storeName }]);

    if (storeError) {
      throw storeError;
    }

    // 5. Assign OWNER Role in tenant_users
    const { error: userError } = await supabase
      .from("tenant_users")
      .insert([{ tenant_id: tenantId, user_id: userId, role: "owner" }]);

    if (userError) {
      throw userError;
    }
  } catch (err: unknown) {
    console.error(`[Signup Action Error] Request ID: ${requestId}`, err);
    const apiError = formatError(err, requestId);
    return { error: apiError.error.message, details: apiError.error.details };
  }

  // Success - Redirect to Dashboard
  redirect("/dashboard");
}

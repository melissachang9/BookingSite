/**
 * Helpers for fetching the current operator's tenant_id.
 * Server-only.
 */
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireTenant() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/admin/login");

  const { data: profile } = await supabase
    .from("users")
    .select("tenant_id, role")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) redirect("/admin/login");
  return { supabase, user, tenantId: profile.tenant_id, role: profile.role };
}

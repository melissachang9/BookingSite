/**
 * Supabase admin client — uses the service role key, bypasses RLS.
 * SERVER-ONLY. Never import this from client code.
 * Use sparingly — for tenant provisioning, webhook handlers, admin operations.
 */
import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

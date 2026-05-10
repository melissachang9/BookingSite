/**
 * Bootstrap script: create the first operator (owner) user for a tenant.
 *
 * Usage:
 *   cd web
 *   npx tsx scripts/bootstrap-owner.ts \
 *     --tenant-slug brow-beauty-lab \
 *     --email you@example.com \
 *     --password 'a-strong-password' \
 *     --name 'Your Name'
 *
 * Idempotent on email: re-running with the same email updates the password and role.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in web/.env.local.
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });

const { values } = parseArgs({
  options: {
    "tenant-slug": { type: "string" },
    email: { type: "string" },
    password: { type: "string" },
    name: { type: "string" },
    role: { type: "string", default: "owner" },
  },
});

function required(key: string, val: string | undefined): string {
  if (!val) {
    console.error(`Missing required argument: --${key}`);
    process.exit(1);
  }
  return val;
}

const tenantSlug = required("tenant-slug", values["tenant-slug"]);
const email = required("email", values.email);
const password = required("password", values.password);
const name = required("name", values.name);
const role = values.role ?? "owner";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  // 1) Look up tenant by slug.
  const { data: tenant, error: tenantErr } = await admin
    .from("tenants")
    .select("id, name")
    .eq("slug", tenantSlug)
    .maybeSingle();

  if (tenantErr) throw tenantErr;
  if (!tenant) {
    console.error(`Tenant not found: ${tenantSlug}`);
    process.exit(1);
  }

  console.log(`✓ Tenant: ${tenant.name} (${tenant.id})`);

  // 2) Create or update the auth user. tenant_id + role go in app_metadata so RLS sees them.
  const appMetadata = { tenant_id: tenant.id, role };

  // Find existing user by email (paginate through auth users).
  let existingUserId: string | undefined;
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) {
      existingUserId = match.id;
      break;
    }
    if (data.users.length < 200) break;
    page++;
  }

  let userId: string;
  if (existingUserId) {
    const { data, error } = await admin.auth.admin.updateUserById(existingUserId, {
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`✓ Updated existing auth user: ${userId}`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMetadata,
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`✓ Created auth user: ${userId}`);
  }

  // 3) Upsert the public.users row.
  const { error: upsertErr } = await admin
    .from("users")
    .upsert(
      {
        id: userId,
        tenant_id: tenant.id,
        email,
        name,
        role,
        is_active: true,
      },
      { onConflict: "id" }
    );

  if (upsertErr) throw upsertErr;
  console.log(`✓ Linked user to tenant as ${role}`);
  console.log(`\nDone. Sign in at http://localhost:3000/admin/login with ${email}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

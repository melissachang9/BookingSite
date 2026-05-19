const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const email = 'staff-smoke-test+20260516@example.com';
const password = 'StaffSmoke123!';
const role = 'staff';
const tenantId = '4d8944d5-0bb7-4385-8bd1-13e8f8909f26';

async function setup() {
  try {
    // 1. Check if user exists in auth
    const { data: listUsers, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    
    let user = listUsers.users.find(u => u.email === email);
    
    if (user) {
      console.log('User already exists in auth, updating...');
      const { data: updatedUser, error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        {
          password: password,
          app_metadata: { role: role, tenant_id: tenantId },
          user_metadata: { role: role, tenant_id: tenantId },
          email_confirm: true
        }
      );
      if (updateError) throw updateError;
      user = updatedUser.user;
    } else {
      console.log('Creating new user in auth...');
      const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        app_metadata: { role: role, tenant_id: tenantId },
        user_metadata: { role: role, tenant_id: tenantId }
      });
      if (createError) throw createError;
      user = newUser.user;
    }

    // 2. Ensure matching record in public.users
    console.log('Upserting user into public.users...');
    const { error: upsertError } = await supabase
      .from('users')
      .upsert({
        id: user.id,
        email: email,
        role: role,
        tenant_id: tenantId,
        is_active: true,
        updated_at: new Date()
      }, { onConflict: 'id' });

    if (upsertError) throw upsertError;

    console.log('Success');
  } catch (err) {
    console.error('Failure:', err.message);
    process.exit(1);
  }
}

setup();

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function setup() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase URL or Service Role Key');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = 'staff-smoke-test+20260515@example.com';
  const password = 'StaffSmoke123!';
  const tenant_id = '4d8944d5-0bb7-4385-8bd1-13e8f8909f26';
  const role = 'staff';

  try {
    // 1. Check if user exists in auth
    const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
    if (listError) throw listError;
    
    let user = users.find(u => u.email === email);

    if (!user) {
      // Create user
      const { data: { user: newUser }, error: createError } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: { role, tenant_id },
        user_metadata: { role, tenant_id }
      });
      if (createError) throw createError;
      user = newUser;
      console.log('Created auth user');
    } else {
      // Update user
      const { data: { user: updatedUser }, error: updateError } = await supabase.auth.admin.updateUserById(
        user.id,
        {
          password,
          app_metadata: { role, tenant_id },
          user_metadata: { role, tenant_id }
        }
      );
      if (updateError) throw updateError;
      user = updatedUser;
      console.log('Updated auth user');
    }

    // 2. Ensure public.users row exists
    const { data: existingPublicUser, error: fetchError } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (fetchError && fetchError.code !== 'PGRST116') throw fetchError;

    if (!existingPublicUser) {
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: user.id,
          email,
          role,
          tenant_id,
          is_active: true
        });
      if (insertError) throw insertError;
      console.log('Inserted public.users row');
    } else {
      const { error: updateError } = await supabase
        .from('users')
        .update({
          role,
          tenant_id,
          is_active: true
        })
        .eq('id', user.id);
      if (updateError) throw updateError;
      console.log('Updated public.users row');
    }

    console.log('Success');
  } catch (err) {
    console.error('Failure:', err.message);
    process.exit(1);
  }
}

setup();

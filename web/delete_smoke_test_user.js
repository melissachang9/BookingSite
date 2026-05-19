const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

async function deleteUser() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const email = 'staff-smoke-test+20260516@example.com';
  console.log('Searching for user with email: ' + email);

  // 1. Get the user from auth
  const { data: { users }, error: listError } = await supabase.auth.admin.listUsers();
  if (listError) {
    console.error('Error listing users:', listError.message);
    process.exit(1);
  }

  const user = users.find(u => u.email === email);

  if (!user) {
    console.log('User not found in auth. Nothing to delete.');
    return;
  }

  const userId = user.id;
  console.log('Found user ID: ' + userId);

  // 2. Delete from public.users
  const { error: dbError } = await supabase
    .from('users')
    .delete()
    .eq('id', userId);

  if (dbError) {
    console.warn('Warning: Error deleting from public.users:', dbError.message);
  } else {
    console.log('Deleted from public.users row (if it existed).');
  }

  // 3. Delete from auth.users
  const { error: authError } = await supabase.auth.admin.deleteUser(userId);

  if (authError) {
    console.error('Error deleting auth user:', authError.message);
    process.exit(1);
  }

  console.log('Successfully deleted auth user.');
  console.log('DELETED: YES');
}

deleteUser().catch(err => {
  console.error(err);
  process.exit(1);
});

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  const userId = '7dfbff84-3caa-4904-b4fa-191af09e2baf';
  const email = 'provider-smoke-test+20260515@example.com';

  const { error: deleteError } = await supabase.auth.admin.deleteUser(userId);

  if (deleteError) {
    console.log('Error deleting user');
    process.exit(1);
  }

  const { data, error: selectError } = await supabase
    .from('users')
    .select('*')
    .eq('email', email);

  if (selectError) {
    process.exit(1);
  }

  if (data.length === 0) {
    console.log('SUCCESS: public.users row was removed');
  } else {
    console.log('FAILURE: public.users row still exists');
  }
}

run();

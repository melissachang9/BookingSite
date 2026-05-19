require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function run() {
  try {
    // 1. Query public.users
    const { data: publicUsers, error: publicError } = await supabase
      .from('users')
      .select('id, name, role, tenant_id, email');

    if (publicError) throw publicError;

    // Report roles and counts
    const roleCounts = publicUsers.reduce((acc, user) => {
      acc[user.role] = (acc[user.role] || 0) + 1;
      return acc;
    }, {});

    console.log('--- Role Distribution ---');
    Object.entries(roleCounts).forEach(([role, count]) => {
      console.log(`${role}: ${count}`);
    });

    // 2. Query auth users
    const { data: { users: authUsers }, error: authError } = await supabase.auth.admin.listUsers();
    
    if (authError) throw authError;

    const authEmails = new Set(authUsers.map(u => u.email));

    // Report matching
    console.log('\n--- Public Users vs Auth Users Match ---');
    publicUsers.forEach(user => {
      const matchStatus = authEmails.has(user.email) ? 'MATCHED' : 'NOT MATCHED';
      console.log(`User ID: ${user.id}, Name: ${user.name}, Role: ${user.role}, Email Check: ${matchStatus}`);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

run();

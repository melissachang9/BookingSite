const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const tenantId = '4d8944d5-0bb7-4385-8bd1-13e8f8909f26';

  // (1) One confirmed booking id with customer_id and deposit_status, preferring the most recent
  // Assuming 'booking' table and 'confirmed' status
  // We'll try to find common column names like 'status', 'created_at'
  const { data: bookingData, error: bookingError } = await supabase
    .from('bookings')
    .select('id, customer_id, deposit_status, created_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: false })
    .limit(1);

  if (bookingError) console.error('Booking Error:', bookingError);
  else {
      console.log('--- Confirmed Booking ---');
      console.log(bookingData[0]);
  }

  // (2) One customer id who has at least one booking with stripe_payment_intent_id not null and stripe_refund_id null
  const { data: customerData, error: customerError } = await supabase
    .from('bookings')
    .select('customer_id')
    .eq('tenant_id', tenantId)
    .not('stripe_payment_intent_id', 'is', null)
    .is('stripe_refund_id', null)
    .limit(1);

  if (customerError) console.error('Customer Error:', customerError);
  else {
      console.log('--- Customer with Payment ---');
      console.log(customerData[0]);
  }
}

run();

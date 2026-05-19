const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const bookingId = 'a2ecd283-9019-46c2-911c-194e3312ced2';
  const customerId = '962a2efd-5eb2-4bc4-9f7b-fab88397ac96';

  // Fetch booking
  const { data: booking, error: bookingError } = await supabase
    .from('bookings')
    .select('*')
    .eq('id', bookingId)
    .single();

  if (bookingError) console.error('Booking error:', bookingError);

  // Fetch customer (wallet balance)
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('wallet_balance_cents')
    .eq('id', customerId)
    .single();

  if (customerError) console.error('Customer error:', customerError);

  const events = booking?.checkout_record_json?.events || [];
  const latestEvent = events.length > 0 ? events[events.length - 1] : null;

  console.log(JSON.stringify({
    status: booking?.status,
    deposit_status: booking?.deposit_status,
    tip_cents: booking?.tip_cents,
    wallet_applied_cents: booking?.wallet_applied_cents,
    event_count: events.length,
    latest_event_kind: latestEvent?.kind,
    latest_event_stripe_session_id: latestEvent?.stripe_session_id,
    latest_event_stripe_payment_intent_id: latestEvent?.stripe_payment_intent_id,
    wallet_balance_cents: customer?.wallet_balance_cents
  }, null, 2));
}

run();

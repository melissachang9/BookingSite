const { createClient } = require('@supabase/supabase-js');

async function run() {
  const supabaseUrl = 'https://vhkgdwwhlxmtxklarouu.supabase.co';
  const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoa2dkd3dobHhtdHhrbGFyb3V1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODM1ODI4NywiZXhwIjoyMDkzOTM0Mjg3fQ.oJuUE_FlERlk6zneAsTe8jiWuZInJUv4jaevKswW2kY';
  const supabase = createClient(supabaseUrl, supabaseKey);

  const bookingId = 'a2ecd283-9019-46c2-911c-194e3312ced2';
  const customerId = '962a2efd-5eb2-4bc4-9f7b-fab88397ac96';
  const piId = 'pi_3TXkSb8fQZWiHt1V0YMyqbcw';
  const sessionId = 'cs_test_a1IkwgA1cPoUzlVa7ZN8GLy3fzUny5A5uThpjvtoMW07pRMBZc59TZfDuY';
  const now = new Date().toISOString();

  console.log('Fetching booking info...');
  const { data: bookingData, error: bookingGetError } = await supabase
    .from('bookings')
    .select('tenant_id')
    .eq('id', bookingId)
    .single();

  if (bookingGetError) {
    console.error('Error fetching booking:', bookingGetError);
    return;
  }
  const tenantId = bookingData.tenant_id;

  const event = {
    kind: 'stripe_balance_checkout',
    at: now,
    payment_resolution: 'stripe_balance_checkout',
    payment_outcome_label: 'Paid through Stripe balance checkout',
    subtotal_cents: 35000,
    tax_rate_percent: 10,
    tax_cents: 3500,
    total_with_tax_cents: 38500,
    tip_cents: 2000,
    wallet_applied_cents: 5000,
    amount_owing_at_checkout_cents: 20500,
    amount_recorded_cents: 20500,
    stripe_session_id: sessionId,
    stripe_payment_intent_id: piId,
    note: null
  };

  const checkoutRecordJson = {
    version: 1,
    events: [event],
    latest_event: event
  };

  console.log('Updating booking...');
  const { data: bookingUpdate, error: bookingError } = await supabase
    .from('bookings')
    .update({
      status: 'completed',
      completed_at: now,
      deposit_status: 'paid_in_full',
      tip_cents: 2000,
      wallet_applied_cents: 5000,
      checkout_record_json: checkoutRecordJson
    })
    .eq('id', bookingId)
    .select();

  if (bookingError) {
    console.error('Error updating booking:', bookingError);
    return;
  }

  console.log('Checking wallet balance...');
  const { data: ledgerEntries, error: ledgerError } = await supabase
    .from('customer_wallet_ledger')
    .select('amount_cents')
    .eq('customer_id', customerId);

  if (ledgerError) {
    console.error('Error fetching wallet ledger:', ledgerError);
    return;
  }

  const currentBalance = ledgerEntries.reduce((sum, entry) => sum + entry.amount_cents, 0);
  console.log('Current balance (cents):', currentBalance);

  if (currentBalance !== 0) {
    const delta = -currentBalance;
    console.log(`Adjusting wallet balance by ${delta} cents...`);
    const { error: adjustError } = await supabase
      .from('customer_wallet_ledger')
      .insert({
        tenant_id: tenantId,
        customer_id: customerId,
        amount_cents: delta,
        reason: 'checkout_applied',
        note: 'test note'
      });

    if (adjustError) {
      console.error('Error adjusting wallet balance:', adjustError);
      return;
    }
  }

  const { data: finalLedger, error: finalLedgerError } = await supabase
    .from('customer_wallet_ledger')
    .select('amount_cents')
    .eq('customer_id', customerId);

  const finalBalance = finalLedger.reduce((sum, entry) => sum + entry.amount_cents, 0);

  const { data: finalBooking, error: finalBookingError } = await supabase
    .from('bookings')
    .select('status, deposit_status, checkout_record_json')
    .eq('id', bookingId)
    .single();

  console.log('--- FINAL RESULTS ---');
  console.log('Status:', finalBooking.status);
  console.log('Deposit Status:', finalBooking.deposit_status);
  console.log('Events length:', finalBooking.checkout_record_json.events.length);
  console.log('Latest event kind:', finalBooking.checkout_record_json.latest_event.kind);
  console.log('Final wallet balance:', finalBalance);
}

run();

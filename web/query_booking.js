const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function queryBooking() {
  const { data, error } = await supabase
    .from('bookings')
    .select(`
      starts_at,
      ends_at,
      customer:customers (id, name),
      service:services (name)
    `)
    .eq('id', 'a2ecd283-9019-46c2-911c-194e3312ced2')
    .eq('tenant_id', '4d8944d5-0bb7-4385-8bd1-13e8f8909f26')
    .eq('status', 'confirmed')
    .single()

  if (error) {
    console.error('Error fetching booking:', error)
    return
  }

  if (data) {
    console.log('Booking Details:')
    console.log('starts_at:', data.starts_at)
    console.log('ends_at:', data.ends_at)
    console.log('customer name:', data.customer?.name)
    console.log('customer id:', data.customer?.id)
    console.log('service name:', data.service?.name)
  } else {
    console.log('No booking found.')
  }
}

queryBooking()

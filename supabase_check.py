import requests
import os
import json

url = "https://vhkgdwwhlxmtxklarouu.supabase.co"
key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoa2dkd3dobHhtdHhrbGFyb3V1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODM1ODI4NywiZXhwIjoyMDkzOTM0Mjg3fQ.oJuUE_FlERlk6zneAsTe8jiWuZInJUv4jaevKswW2kY"
booking_id = "a2ecd283-9019-46c2-911c-194e3312ced2"
customer_id = "962a2efd-5eb2-4bc4-9f7b-fab88397ac96"

headers = {
    "apikey": key,
    "Authorization": f"Bearer {key}",
    "Content-Type": "application/json"
}

# Fetch booking
b_res = requests.get(f"{url}/rest/v1/bookings?id=eq.{booking_id}&select=*", headers=headers)
booking = b_res.json()[0] if b_res.json() else None

# Fetch customer
c_res = requests.get(f"{url}/rest/v1/customers?id=eq.{customer_id}&select=*", headers=headers)
customer = c_res.json()[0] if c_res.json() else None

if booking:
    record_json = booking.get('checkout_record_json', {})
    events = record_json.get('events', [])
    latest_event_kind = events[-1].get('kind') if events else None
    
    print(json.dumps({
        "booking_status": booking.get('status'),
        "deposit_status": booking.get('deposit_status'),
        "completed_at": booking.get('completed_at'),
        "tip_cents": booking.get('tip_cents'),
        "wallet_applied_cents": booking.get('wallet_applied_cents'),
        "checkout_record_json_event_count": len(events),
        "latest_event_kind": latest_event_kind,
        "customer_wallet_balance_cents": customer.get('wallet_balance_cents') if customer else None
    }, indent=2))
else:
    print("Booking not found")

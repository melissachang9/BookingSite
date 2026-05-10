# Metrics a Booking App Should Track for CAC, LTV, and Sales Economics

## Purpose

This document answers a narrower question than the guiding-principles brief:

What exactly should the app track so businesses can calculate unit economics like:

- `CAC`
- `sales CAC`
- `marketing CAC`
- `LTV`
- `LTV:CAC`
- `payback period`
- `cost per lead`
- `cost per booked appointment`
- `cost per show`
- `return on ad spend`

The short answer is: the app needs to track more than appointments.

It must track four things together:

- lead source and attribution
- funnel movement
- revenue and gross profit
- acquisition costs

Without all four, the business can calculate only partial metrics.

## The Non-Negotiable Rule

Every important record in the system needs a stable ID and a timestamp.

At minimum:

- `lead_id`
- `customer_id`
- `appointment_id`
- `location_id`
- `staff_id`
- `service_id`
- `campaign_id` or campaign fields
- `payment_id`

And the app should preserve the timestamps for:

- lead created
- first response
- appointment booked
- appointment scheduled time
- appointment completed
- payment collected
- customer rebooked
- customer reactivated

If the app cannot connect a customer back to an acquisition source and forward to revenue, CAC and LTV become unreliable.

## What the App Must Track

## 1. Lead Metrics

The system should treat a lead as the first measurable expression of demand.

Track these fields for every lead:

- `lead_id`
- `created_at`
- `location_id`
- `assigned_rep_id` if sales-assisted
- `first_touch_channel`
- `first_touch_source`
- `first_touch_campaign`
- `first_touch_ad_group` or equivalent
- `first_touch_ad`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `utm_term`
- `utm_content`
- `landing_page`
- `referrer`
- `call_tracking_number` if phone leads matter
- `form_name` or intake source
- `lead_status` such as new, contacted, qualified, booked, lost
- `lost_reason`
- `response_time_seconds`
- `qualified_at`
- `booked_at`

Why it matters:

- You need lead volume to calculate `cost per lead`.
- You need source data to calculate channel-level CAC.
- You need response time and qualification to diagnose conversion problems.

## 2. Customer Metrics

The app should treat customer records separately from lead records.

Track these fields for every customer:

- `customer_id`
- `first_lead_id`
- `first_touch_channel`
- `first_touch_campaign`
- `latest_touch_channel`
- `acquired_at`
- `first_booked_at`
- `first_completed_at`
- `is_new_customer`
- `is_returning_customer`
- `last_completed_at`
- `reactivated_at` if applicable
- `churned_at` or `inactive_since`
- `lifetime_bookings`
- `lifetime_completed_appointments`
- `lifetime_revenue`
- `lifetime_refunds`
- `lifetime_discount_amount`
- `lifetime_gross_profit`
- `lifetime_upsell_revenue`

Why it matters:

- CAC is usually calculated per new customer acquired.
- LTV is calculated per customer over time.
- Cohort reporting depends on knowing when the customer was first acquired.

## 3. Appointment Metrics

This is the core scheduling layer, but it needs financial and attribution detail.

Track these fields for every appointment:

- `appointment_id`
- `customer_id`
- `location_id`
- `staff_id`
- `service_id`
- `booked_at`
- `scheduled_for`
- `status`
- `status_reason`
- `completed_at`
- `cancelled_at`
- `rescheduled_from_appointment_id`
- `source_channel`
- `source_campaign`
- `booking_method` such as website, phone, chat, staff-entered
- `is_first_appointment_for_customer`
- `expected_revenue`
- `actual_revenue`
- `discount_amount`
- `refund_amount`
- `upsell_revenue`
- `tip_amount` if relevant to the vertical
- `gross_profit`

Statuses should at least include:

- booked
- confirmed
- cancelled
- rescheduled
- no-show
- completed

Why it matters:

- You need booked appointments to calculate booking conversion.
- You need completed appointments to calculate actual realized value.
- No-shows and cancellations are major revenue leaks for appointment businesses.

## 4. Payment and Revenue Metrics

The app should not rely only on appointment price. It should track actual money movement.

Track these fields for every payment or invoice:

- `payment_id`
- `customer_id`
- `appointment_id` if tied to an appointment
- `invoice_id`
- `created_at`
- `paid_at`
- `revenue_amount`
- `discount_amount`
- `refund_amount`
- `tax_amount`
- `net_revenue`
- `cost_of_service`
- `gross_profit`
- `payment_method`
- `is_subscription_revenue`
- `is_package_revenue`
- `is_membership_revenue`
- `is_upsell`

Why it matters:

- LTV should be based on real collected revenue, not just theoretical menu pricing.
- Gross-profit LTV is better than revenue-only LTV for decision-making.

## 5. Cost Metrics

This is where many apps fail.

If the app is supposed to help businesses calculate CAC, it must either track or import acquisition costs.

Track or import these cost categories by date, location, and source where possible:

- ad spend by campaign
- agency fees
- freelancer fees
- call center cost
- appointment setter payroll
- sales rep salary allocation
- commissions
- outbound software costs
- direct mail cost
- referral payouts
- affiliate payouts
- discounts or free-offer fulfillment cost
- onboarding cost if the business uses a sales team or concierge model

Recommended cost table fields:

- `cost_entry_id`
- `date`
- `location_id`
- `channel`
- `source`
- `campaign`
- `cost_type`
- `amount`
- `notes`

Why it matters:

- Without cost data, the app can show conversion metrics but not true CAC.

## 6. Attribution Metrics

The app should support both first-touch and last-touch attribution at minimum.

Track:

- first-touch source
- first-touch campaign
- last-touch source
- last-touch campaign
- referral source
- promo code used
- inbound call source
- landing page source
- reactivation campaign source

Advanced, but useful later:

- multi-touch attribution log
- touchpoint sequence
- assisted conversion count

Why it matters:

- First-touch is useful for understanding what creates demand.
- Last-touch is useful for understanding what closes demand.
- Both matter when calculating CAC by channel.

## 7. Retention and Repeat-Purchase Metrics

LTV is mostly a retention question.

Track these metrics by customer and cohort:

- days to second booking
- days to third booking
- repeat booking rate
- rebooking rate after completed appointment
- active months
- churn or inactivity threshold reached
- reactivation count
- membership retention if subscriptions exist
- package utilization rate if prepaid packages exist

Why it matters:

- A booking business with strong reacquisition and repeat usage can support a much higher CAC.

## The Core Metrics the App Should Calculate

## Acquisition Metrics

- leads
- qualified leads
- new customers acquired
- cost per lead
- cost per qualified lead
- cost per booked appointment
- cost per completed appointment
- marketing CAC
- sales CAC
- blended CAC

## Funnel Metrics

- lead-to-contact rate
- contact-to-booked rate
- lead-to-booked rate
- booked-to-show rate
- show-to-sale rate
- lead-to-customer rate
- cancellation rate
- no-show rate
- reschedule rate
- average response time

## Revenue Metrics

- first-purchase revenue
- average revenue per completed appointment
- average revenue per customer
- upsell revenue per customer
- monthly recurring revenue if subscriptions exist
- package revenue if prepaid bundles exist
- refund rate
- gross margin
- gross profit per customer

## Retention Metrics

- repeat purchase rate
- second booking rate
- third booking rate
- 30/60/90 day retention
- monthly customer churn
- reactivation rate
- average customer lifespan

## Unit Economics Metrics

- LTV
- gross-profit LTV
- LTV:CAC ratio
- CAC payback period
- contribution margin by customer cohort
- ROAS by channel
- MER if the business wants blended marketing efficiency

## Formulas the App Should Support

These formulas should be available in reporting.

## 1. Cost Per Lead

`cost per lead = channel spend / number of leads from that channel`

## 2. Cost Per Booked Appointment

`cost per booked appointment = channel spend / appointments booked from that channel`

## 3. Cost Per Show

`cost per show = channel spend / completed or attended appointments from that channel`

## 4. Marketing CAC

`marketing CAC = total marketing spend / new customers acquired`

This includes ad spend, agency fees, and marketing tools if the business wants fully loaded CAC.

## 5. Sales CAC

`sales CAC = total sales cost / new customers closed through sales`

This includes sales payroll allocation, commissions, appointment setters, and call center cost.

## 6. Blended CAC

`blended CAC = (marketing spend + sales spend) / total new customers acquired`

## 7. Average Revenue Per Customer

`average revenue per customer = total collected revenue / number of customers`

## 8. Average Gross Profit Per Customer

`average gross profit per customer = total gross profit / number of customers`

## 9. Simple Revenue LTV

`LTV = average revenue per customer over the customer's lifetime`

This is easy to understand, but weaker than gross-profit LTV.

## 10. Gross-Profit LTV

`gross-profit LTV = average gross profit per customer over lifetime`

This is the more useful version if the app can track cost of service.

## 11. Frequency-Based LTV

For appointment businesses, this is often practical:

`LTV = average revenue per completed visit x average completed visits per customer lifetime`

Better version:

`gross-profit LTV = average gross profit per completed visit x average completed visits per customer lifetime`

## 12. Subscription-Based LTV

If the business has memberships:

`LTV = ARPU / churn rate`

or more conservatively:

`gross-profit LTV = (ARPU x gross margin %) / churn rate`

## 13. LTV:CAC Ratio

`LTV:CAC = LTV / CAC`

## 14. CAC Payback Period

`payback period = CAC / average monthly gross profit per newly acquired customer`

## Important Implementation Note

The app should let businesses choose whether they want to calculate:

- revenue-based LTV
- gross-profit LTV
- first-touch CAC
- last-touch CAC
- blended CAC

Different operators use different finance rules. The app should not hard-code only one interpretation.

## What the App Needs From Integrations

Some metrics can be tracked natively. Some require imports or integrations.

## Native App Data

The app can usually track natively:

- leads
- bookings
- cancellations
- no-shows
- completed appointments
- payment amounts
- repeat visits
- reactivation events
- source data from forms and booking flows

## External Integrations Needed

The app should integrate with or import from:

- Google Ads
- Meta Ads
- Google Analytics or web analytics
- call tracking tools
- POS or payment processor
- payroll or manual sales cost entry
- CRM if a separate sales process exists
- email and SMS platforms if campaigns happen outside the app

Without ad-spend and sales-cost inputs, CAC is only estimated, not fully measured.

## Minimum Viable Dashboard the App Should Show

If the app wants to be taken seriously as a growth system, every business should be able to see:

- leads by source
- booked appointments by source
- completed appointments by source
- new customers by source
- cost per lead by source
- CAC by source
- first-visit revenue by source
- 30/60/90 day LTV by source
- LTV:CAC by source
- payback period by source
- no-show and cancellation rates by source, service, and staff
- repeat booking rate by source and cohort

That one dashboard turns the product from a scheduler into a business operating system.

## Data Definitions the App Should Lock Down Early

To avoid reporting chaos later, define these terms clearly inside the product:

- what counts as a lead
- what counts as a qualified lead
- what counts as a new customer
- what counts as an acquired customer
- whether CAC uses first-touch, last-touch, or blended attribution
- whether LTV is revenue-based or gross-profit-based
- what inactivity threshold counts as churn
- whether rescheduled appointments stay attached to the original acquisition source

If those definitions drift by customer or report, trust in the analytics will collapse.

## Best Practical Recommendation

If you want the app to support serious business owners, prioritize this metric stack first:

- lead source
- booking source
- new customer count
- completed appointment revenue
- gross profit per completed appointment
- ad spend by source
- sales cost by source or team
- repeat booking behavior
- 30/60/90 day customer cohorts

That is enough to support:

- CAC
- sales CAC
- blended CAC
- first-visit ROI
- cohort LTV
- LTV:CAC
- payback period

## Final Principle

The app should not only answer:

- how many appointments were booked?

It should answer:

- where did this customer come from?
- how much did it cost to acquire them?
- how much revenue and gross profit have they produced?
- how often do they come back?
- how long until their value pays back the acquisition cost?

Once the app can answer those questions, businesses can calculate real sales and marketing economics rather than just count appointments.
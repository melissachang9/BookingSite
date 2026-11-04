import { LegalPage } from "../lib/legal";

export const metadata = { title: "Terms of use" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms of use">
      <p>
        These terms cover your use of this online booking page. The appointment itself is a service you buy from
        the business you are booking with, not from the booking software.
      </p>

      <h2>Booking and payment</h2>
      <ul>
        <li>When you choose a time, it is held for you for a short period while you finish your details. If you do not finish, the time is released.</li>
        <li>Your booking is confirmed once any required forms and deposit are complete. The business sets its own prices, deposit and tax.</li>
        <li>Card payments are handled by the business&apos;s payment provider. The booking software does not see or store your full card number.</li>
      </ul>

      <h2>Cancellations, changes and no-shows</h2>
      <ul>
        <li>Each business sets its own cancellation window and refund rules. They are shown to you before you pay and in your confirmation.</li>
        <li>Cancelling inside the window can mean the deposit is not refunded. Missing an appointment without cancelling can mean a no-show fee, if the business has set one.</li>
        <li>Use the private link in your confirmation to change or cancel. Keep that link to yourself; anyone who has it can manage the booking.</li>
      </ul>

      <h2>Forms and health information</h2>
      <p>
        Some services need intake or consent forms. Please answer honestly and completely. Tell the business about
        anything that could affect your treatment. Your answers are shared with the business, which may decline or
        change a service based on them.
      </p>

      <h2>Reminders</h2>
      <p>
        If you give an email address or phone number, the business may send you reminders and updates about your
        appointment. You can reply STOP to text messages or ask the business to stop contacting you.
      </p>

      <h2>Using this page</h2>
      <p>
        Do not misuse the page: no automated bookings, no attempts to access other people&apos;s information, and no
        false details. We may block access that harms the service or other people.
      </p>

      <h2>Liability</h2>
      <p>
        The business is responsible for the services it provides. The booking software is provided as is and is not
        responsible for the quality of any service, or for losses from a page being unavailable, to the extent the
        law allows. Nothing here limits rights you have under consumer law.
      </p>

      <h2>Changes</h2>
      <p>We may update these terms. The date at the top shows the latest version.</p>
    </LegalPage>
  );
}

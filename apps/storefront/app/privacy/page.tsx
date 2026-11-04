import { LegalPage } from "../lib/legal";

export const metadata = { title: "Privacy policy" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>
        This explains what is collected when you book online, who sees it and what you can ask for. The business
        you book with decides why your information is used for your appointment; the booking software processes it
        on the business&apos;s behalf.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Booking details:</strong> your name, email, phone, the service, the time and any notes you add.</li>
        <li><strong>Forms:</strong> answers to intake and consent forms, which can include health information, and any files or signatures you upload.</li>
        <li><strong>Payments:</strong> amounts, deposits, refunds and a payment reference. Card numbers go to the payment provider and are not stored by us.</li>
        <li><strong>How you found the business:</strong> the page or campaign you came from, so the business knows which marketing works.</li>
        <li><strong>Technical data:</strong> your IP address is used briefly to limit abuse and is not used to identify you.</li>
      </ul>

      <h2>How it is used</h2>
      <ul>
        <li>To make, hold, confirm, change and cancel your appointment and take payment.</li>
        <li>To send confirmations, form requests and reminders by email or text.</li>
        <li>To let the business keep your visit history and prepare for your visit.</li>
        <li>To keep the service secure and to keep an audit record of changes to bookings and payments.</li>
      </ul>

      <h2>Cookies and advertising</h2>
      <p>
        We use a cookie to remember where you came from while you book. If the business uses advertising tools
        such as the Meta Pixel or Google tag, they only run after you accept them where the law requires consent,
        and the business may send them the fact that you booked. You can decline and still book.
      </p>

      <h2>Who sees it</h2>
      <p>
        The business and its authorized staff, and the service providers that run the booking software: hosting,
        email and text delivery, payment processing and, if the business has turned them on, advertising platforms.
        We do not sell your information.
      </p>

      <h2>How long we keep it</h2>
      <p>
        The business keeps booking, form and payment records for as long as it needs them for your care, its
        accounts and legal duties. Financial records are kept even if you ask for other data to be removed.
      </p>

      <h2>Your choices</h2>
      <p>
        You can ask the business to show you, correct or delete your information, or to stop sending you messages.
        Contact the business directly; it can act on the request in the booking system. Reply STOP to any text to
        opt out of texts.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over encrypted connections and access is limited to the business&apos;s authorized staff.
        No system is perfectly secure, so please keep your private booking link to yourself.
      </p>

      <h2>Changes</h2>
      <p>We may update this policy. The date at the top shows the latest version.</p>
    </LegalPage>
  );
}

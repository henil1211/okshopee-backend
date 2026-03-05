import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function ContactUs() {
  return (
    <StaticPageLayout
      title="Contact Us"
      subtitle="All support is handled through the in-app ticket system."
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Ticket-Based Support Only</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Submit your issue from the <a href="/support" className="text-[#7cc9ff] hover:underline">Support Ticket Center</a>. External support channels are not used.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Important Notice</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Do not create multiple tickets for the same issue. Typical response time is up to 24 hours.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Before Submitting a Ticket</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Include your User ID, transaction ID, amount, payment method, and screenshot/payment proof for faster verification.
        </p>
      </section>
    </StaticPageLayout>
  );
}

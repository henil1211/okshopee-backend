import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function ContactUs() {
  return (
    <StaticPageLayout
      title="Contact Us"
      subtitle="Reach the ReferNex support team for account, policy, or platform-related assistance."
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Support Email</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Email: <span className="text-[#7cc9ff]">support@refernex.com</span>
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Support Hours</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Monday to Saturday, 10:00 AM to 7:00 PM (local business hours). Response times may vary during high-volume periods.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Before You Contact Support</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Please include your User ID, registered email, and relevant transaction references so the team can verify and resolve your issue faster.
        </p>
      </section>
    </StaticPageLayout>
  );
}

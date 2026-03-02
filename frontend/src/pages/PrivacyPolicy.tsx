import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function PrivacyPolicy() {
  return (
    <StaticPageLayout
      title="Privacy Policy"
      subtitle="This policy explains how ReferNex collects, uses, and protects your information."
      updatedOn="March 2, 2026"
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Information We Collect</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          We may collect account details (name, email, phone), referral activity, transaction records, and technical usage data needed to operate and secure the
          platform.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">How We Use Data</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Data is used to provide services, process transactions, maintain account security, communicate important updates, and improve platform performance.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Data Sharing</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          We do not sell personal data. Information may be shared with authorized service providers and legal authorities where required by law or platform compliance.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Security and Retention</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          We apply reasonable technical and operational safeguards. Records may be retained for compliance, security, and audit purposes as required.
        </p>
      </section>
    </StaticPageLayout>
  );
}

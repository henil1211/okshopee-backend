import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function TermsAndConditions() {
  return (
    <StaticPageLayout
      title="Terms & Conditions"
      subtitle="These terms govern your use of the ReferNex platform and services."
      updatedOn="March 2, 2026"
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Eligibility and Accounts</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Users must provide accurate account information and are responsible for safeguarding login credentials and transaction passwords.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Platform Usage</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          You agree to use ReferNex lawfully and in accordance with platform rules. Fraudulent, abusive, or manipulative activity may result in account restriction
          or termination.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Rewards and Performance</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Rewards are performance-based and subject to qualification rules, partner terms, and policy updates. Earnings are not guaranteed.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Policy Updates</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          ReferNex may revise platform rules, eligibility criteria, and terms at any time. Continued use of the platform constitutes acceptance of updated terms.
        </p>
      </section>
    </StaticPageLayout>
  );
}

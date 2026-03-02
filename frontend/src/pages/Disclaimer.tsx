import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function Disclaimer() {
  return (
    <StaticPageLayout
      title="Disclaimer"
      subtitle="Important risk and responsibility disclosures for ReferNex members."
      updatedOn="March 2, 2026"
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">No Guaranteed Earnings</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Referral and community-based rewards depend on individual effort, qualifying activity, and policy conditions. Income outcomes are not guaranteed.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Third-Party Offers</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Discounts and partner offers are controlled by third-party providers and may change or end without notice.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">User Responsibility</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Users are responsible for evaluating participation decisions, maintaining account security, and complying with local laws and tax obligations.
        </p>
      </section>
    </StaticPageLayout>
  );
}

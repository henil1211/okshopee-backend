import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function RefundPolicy() {
  return (
    <StaticPageLayout
      title="Refund Policy"
      subtitle="This policy describes refund eligibility and non-refundable scenarios on ReferNex."
      updatedOn="March 2, 2026"
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">General Policy</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Due to the digital and performance-linked nature of platform services, most completed activations and consumed digital resources are non-refundable.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Possible Exceptions</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Refund exceptions may be considered for duplicate charges, verified technical processing errors, or transactions explicitly identified as refundable by the
          platform.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Request Process</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Eligible requests should be submitted through official support with transaction details and account ID. Review timelines and outcomes depend on verification.
        </p>
      </section>
    </StaticPageLayout>
  );
}

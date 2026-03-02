import StaticPageLayout from '@/components/public/StaticPageLayout';

export default function AboutUs() {
  return (
    <StaticPageLayout
      title="About ReferNex"
      subtitle="Learn how ReferNex supports smart shopping, digital networking, and community-based growth."
    >
      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Who We Are</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          ReferNex is an independent referral and rewards platform built for individuals who want to save while they shop and earn through qualified referrals.
          We combine digital convenience with transparent participation models to help users build long-term value.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">What We Offer</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          Members can access partner offers, discount opportunities, and performance-based reward systems. Our focus is practical value: smart spending, consistent
          effort, and responsible network growth.
        </p>
      </section>

      <section className="glass border border-white/10 rounded-2xl p-6">
        <h2 className="font-heading text-xl font-semibold text-white">Our Approach</h2>
        <p className="mt-3 text-white/70 leading-relaxed">
          ReferNex emphasizes transparent policies, platform improvement, and community-oriented collaboration. We continue refining user experience, compliance
          standards, and operational systems for sustainable growth.
        </p>
      </section>
    </StaticPageLayout>
  );
}

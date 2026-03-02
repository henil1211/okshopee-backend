import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BadgeCheck, Menu, Sparkles, X } from 'lucide-react';

import BrandLogo from '@/components/BrandLogo';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import PublicFooter from '@/components/PublicFooter';

type Feature = {
  title: string;
  description: string;
};

type Faq = {
  question: string;
  answer: string;
};

const features: Feature[] = [
  {
    title: 'Smart Shopping. Smart Earnings.',
    description:
      'Shop through trusted online partners and enjoy exclusive discounts and cashback offers. Every eligible purchase brings added value and additional earning potential.'
  },
  {
    title: 'Earn While You Shop',
    description:
      'Turn everyday spending into meaningful rewards. Share deals with friends and family and build a growing stream of referral-based income.'
  },
  {
    title: 'Independent & Flexible',
    description:
      'No boss. No fixed hours. No limitations. Promote digitally at your own pace and grow according to your goals.'
  },
  {
    title: 'Dual Benefit Model: Save + Earn',
    description:
      'Reduce shopping costs while earning rewards from qualified referrals. Experience a system designed for both savings and income.'
  },
  {
    title: 'Digital Network Growth',
    description:
      'Build a strong online community that supports shared progress. Expand your reach, increase your influence, and unlock long-term opportunities.'
  },
  {
    title: 'Community-Based Wealth Creation',
    description:
      'ReferNex promotes collaboration, transparency, and mutual growth. Through smart referrals and teamwork, members can build sustainable reward-based income.'
  }
];

const faqs: Faq[] = [
  {
    question: 'What is ReferNex?',
    answer:
      'ReferNex is an affiliate-based online shopping and referral platform that provides discounts and reward points on eligible purchases.'
  },
  {
    question: 'How do I join?',
    answer: 'Register using a unique referral link and activation code provided by an existing member.'
  },
  {
    question: 'How are rewards calculated?',
    answer: 'Reward points are earned based on eligible shopping transactions and platform guidelines.'
  },
  {
    question: 'Are discounts guaranteed?',
    answer: 'Discounts and promotional offers are subject to official partner company terms, conditions, and availability.'
  },
  {
    question: 'Is community-based income guaranteed?',
    answer:
      'No. Referral and community-based earnings are performance-based and not guaranteed. Rewards and policies may be updated or modified at any time.'
  }
];

const commitmentPoints = [
  'Transparent reward structure',
  'Independent and flexible participation',
  'Community-focused growth',
  'Continuous platform improvement'
];

export default function Landing() {
  const navigate = useNavigate();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const containerClass = 'max-w-7xl mx-auto px-4 sm:px-6 lg:px-8';

  return (
    <div className="landing-page min-h-screen bg-[#0a0e17] text-white">
      <header className="fixed inset-x-0 top-0 z-50 glass border-b border-white/5">
        <div className={`${containerClass} flex h-16 items-center justify-between`}>
          <a href="#top" className="flex items-center gap-2.5">
            <BrandLogo className="h-10 w-10 rounded-xl" />
            <span className="font-heading text-xl font-bold text-white">ReferNex</span>
          </a>

          <nav className="hidden items-center gap-7 text-sm font-semibold md:flex">
            <a href="#why" className="text-white/70 transition-colors hover:text-white">
              Why ReferNex
            </a>
            <a href="#how" className="text-white/70 transition-colors hover:text-white">
              How It Works
            </a>
            <a href="#faq" className="text-white/70 transition-colors hover:text-white">
              FAQ
            </a>
            <a href="#commitment" className="text-white/70 transition-colors hover:text-white">
              Commitment
            </a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <Button variant="ghost" className="hidden text-sm text-white/70 hover:bg-white/10 hover:text-white sm:inline-flex" onClick={() => navigate('/login')}>
              Sign In
            </Button>
            <Button className="hidden btn-primary rounded-full px-5 text-sm sm:inline-flex" onClick={() => navigate('/register')}>
              Create Account
            </Button>
            <Button variant="ghost" className="text-sm text-white/70 hover:bg-white/10 hover:text-white sm:hidden" onClick={() => navigate('/login')}>
              Sign In
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-white/80 hover:bg-white/10 hover:text-white md:hidden"
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              onClick={() => setMobileMenuOpen((prev) => !prev)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>
          </div>
        </div>
        {mobileMenuOpen && (
          <div className="border-t border-white/10 bg-[#0a1424]/95 md:hidden">
            <div className={`${containerClass} py-4`}>
              <div className="grid gap-2 text-sm font-semibold">
                <a href="#why" className="rounded-lg px-3 py-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                  Why ReferNex
                </a>
                <a href="#how" className="rounded-lg px-3 py-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                  How It Works
                </a>
                <a href="#faq" className="rounded-lg px-3 py-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                  FAQ
                </a>
                <a href="#commitment" className="rounded-lg px-3 py-2 text-white/75 transition-colors hover:bg-white/10 hover:text-white" onClick={() => setMobileMenuOpen(false)}>
                  Commitment
                </a>
              </div>
              <div className="mt-4 grid gap-2">
                <Button
                  variant="outline"
                  className="h-10 border-white/20 bg-transparent text-white hover:bg-white/10"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate('/login');
                  }}
                >
                  Sign In
                </Button>
                <Button
                  className="btn-primary h-10"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    navigate('/register');
                  }}
                >
                  Create Account
                </Button>
              </div>
            </div>
          </div>
        )}
      </header>

      <main id="top" className="pt-16">
        <section className="relative overflow-hidden border-b border-white/5">
          <div className="absolute inset-0 bg-gradient-to-br from-[#004e9a]/30 via-transparent to-[#118bdd]/20" />
          <div className="absolute inset-0 network-bg opacity-20" />

          <div className={`${containerClass} relative grid gap-12 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:py-28`}>
            <div className="animate-slide-in">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#118bdd]/30 bg-[#118bdd]/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.1em] text-[#7cc9ff]">
                <Sparkles className="h-3.5 w-3.5" />
                The Next-Generation Referral Network
              </p>

              <h1 className="font-heading text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
                Empowering people to shop smarter, earn smarter, and grow together.
              </h1>

              <p className="mt-6 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
                ReferNex is an independent referral and rewards platform designed to help individuals create value through smart shopping, digital networking, and community
                collaboration. We combine exclusive online discounts with a performance-based referral system, giving you the opportunity to save and earn at the same time.
              </p>

              <p className="mt-5 text-lg font-semibold text-white">Start today. Grow your network. Build your future.</p>

              <div className="mt-9 flex flex-wrap gap-3">
                <Button className="btn-primary h-11 rounded-full px-6" onClick={() => navigate('/register')}>
                  Create Your Account
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  className="h-11 rounded-full border-white/20 bg-transparent px-6 text-white hover:bg-white/10"
                  onClick={() => document.getElementById('how')?.scrollIntoView({ behavior: 'smooth' })}
                >
                  Learn More
                </Button>
              </div>
            </div>

            <div className="relative">
              <div className="absolute -right-8 top-8 h-48 w-48 rounded-full bg-[#118bdd]/25 blur-3xl" />
              <div className="absolute -left-8 bottom-10 h-44 w-44 rounded-full bg-[#004e9a]/30 blur-3xl" />

              <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#050912] p-6 shadow-[0_30px_80px_rgba(0,0,0,0.45)] sm:p-8">
                <div className="absolute inset-0 network-bg opacity-10" />
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(56,189,248,0.2),transparent_40%),radial-gradient(circle_at_80%_80%,rgba(17,139,221,0.18),transparent_45%)]" />

                <div className="relative">
                  <h2 className="font-heading text-3xl font-bold text-white sm:text-4xl">Built for Digital Opportunity</h2>
                  <p className="mt-3 text-sm leading-relaxed text-white/75 sm:text-base">
                    ReferNex is built for individuals who believe in smart opportunity, digital growth, and shared success.
                  </p>

                  <div className="mt-7 space-y-4">
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <p className="text-xs uppercase tracking-wide text-[#7cc9ff]">Model</p>
                      <p className="mt-1 text-base font-semibold text-white">Dual Benefit: Save + Earn</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <p className="text-xs uppercase tracking-wide text-[#7cc9ff]">Participation</p>
                      <p className="mt-1 text-base font-semibold text-white">Independent and flexible growth path</p>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                      <p className="text-xs uppercase tracking-wide text-[#7cc9ff]">Approach</p>
                      <p className="mt-1 text-base font-semibold text-white">Transparent, community-focused, and scalable</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="why" className="py-20">
          <div className={containerClass}>
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">Why Choose ReferNex</p>
              <h2 className="mt-3 font-heading text-3xl font-bold text-white sm:text-4xl">Financial growth is stronger when it is built together.</h2>
              <p className="mt-4 text-white/70">Our platform is designed to be simple, transparent, and opportunity-driven.</p>
            </div>

            <div className="mt-11 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => (
                <Card key={feature.title} className="glass border-white/10 card-hover">
                  <CardContent className="p-6">
                    <p className="mb-4 text-sm font-semibold text-[#7cc9ff]">0{index + 1}</p>
                    <h3 className="font-heading text-xl font-semibold text-white">{feature.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-white/70">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="border-y border-white/5 bg-[#111827]/50 py-20">
          <div className={containerClass}>
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">How It Works</p>
              <h2 className="mt-3 font-heading text-3xl font-bold text-white sm:text-4xl">Three steps to start building momentum</h2>
            </div>

            <div className="mt-12 grid gap-6 lg:grid-cols-3">
              <Card className="glass border-white/10">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold text-[#7cc9ff]">Step 1</p>
                  <h3 className="mt-2 font-heading text-xl font-semibold text-white">Register & Activate</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">Create your account using a unique referral link and activation PIN provided by your sponsor.</p>
                </CardContent>
              </Card>
              <Card className="glass border-white/10">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold text-[#7cc9ff]">Step 2</p>
                  <h3 className="mt-2 font-heading text-xl font-semibold text-white">Build Your Network</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">Share your referral link and invite others to join. As your network grows, so does your opportunity.</p>
                </CardContent>
              </Card>
              <Card className="glass border-white/10">
                <CardContent className="p-6">
                  <p className="text-sm font-semibold text-[#7cc9ff]">Step 3</p>
                  <h3 className="mt-2 font-heading text-xl font-semibold text-white">Shop & Earn</h3>
                  <p className="mt-3 text-sm leading-relaxed text-white/70">Access exclusive discounts on eligible products and earn reward points based on qualifying purchases.</p>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        <section className="py-20">
          <div className={`${containerClass} grid gap-8 lg:grid-cols-2`}>
            <Card className="glass border-white/10">
              <CardContent className="p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">Success Story</p>
                <h2 className="mt-3 font-heading text-3xl font-bold text-white">From Three People to a Growing Network</h2>
                <p className="mt-4 text-sm leading-relaxed text-white/70">Every great journey begins with a small step.</p>

                <div className="mt-7 space-y-5">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Raj</p>
                    <p className="mt-1 text-sm text-white/70">
                      Raj joined ReferNex to save on everyday shopping. After experiencing real value, he shared the opportunity with two friends.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Priya</p>
                    <p className="mt-1 text-sm text-white/70">Priya saw the potential and consistently shared deals within her network. Her effort built trust and momentum.</p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="font-semibold text-white">Amit</p>
                    <p className="mt-1 text-sm text-white/70">Amit started as a shopper, then became a promoter. With consistent action, he expanded his network and increased his rewards.</p>
                  </div>
                </div>

                <p className="mt-6 text-sm leading-relaxed text-white/70">
                  What started with three individuals evolved into a supportive, growing community. Success does not begin with hundreds of people. It begins with action,
                  consistency, and collaboration.
                </p>
              </CardContent>
            </Card>

            <Card id="commitment" className="border-[#118bdd]/30 bg-gradient-to-br from-[#0f1d35] to-[#0a1424]">
              <CardContent className="p-7">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">Our Commitment</p>
                <h2 className="mt-3 font-heading text-3xl font-bold text-white">Built for sustainable progress</h2>
                <p className="mt-4 text-sm leading-relaxed text-white/80">
                  ReferNex is committed to long-term value through transparent systems, flexible participation, and continuous platform development.
                </p>

                <div className="mt-7 space-y-3">
                  {commitmentPoints.map((item) => (
                    <div key={item} className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                      <BadgeCheck className="mt-0.5 h-4 w-4 text-[#7cc9ff]" />
                      <p className="text-sm text-white/90">{item}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-8 rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">Important Notice</p>
                  <p className="mt-2 text-sm text-white/80">
                    Referral and community-based earnings are performance-based and not guaranteed. Offer availability and policy details may change over time.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section id="faq" className="border-y border-white/5 bg-[#111827]/50 py-20">
          <div className={containerClass}>
            <div className="text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#7cc9ff]">Frequently Asked Questions</p>
              <h2 className="mt-3 font-heading text-3xl font-bold text-white sm:text-4xl">Everything you need to know before you begin</h2>
            </div>

            <div className="mt-10 space-y-4">
              {faqs.map((faq) => (
                <Card key={faq.question} className="glass border-white/10">
                  <CardContent className="p-6">
                    <h3 className="font-heading text-lg font-semibold text-white">{faq.question}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/70">{faq.answer}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </section>

        <section className="relative overflow-hidden py-20">
          <div className="absolute inset-0 bg-gradient-to-r from-[#118bdd]/20 via-transparent to-[#004e9a]/20" />
          <div className={`${containerClass} relative text-center`}>
            <h2 className="font-heading text-4xl font-bold leading-tight text-white sm:text-5xl">Ready to Take the Next Step?</h2>
            <p className="mx-auto mt-5 max-w-3xl text-base leading-relaxed text-white/70 sm:text-lg">
              Join ReferNex today and become part of a next-generation referral network designed for the digital economy.
            </p>
            <Button className="btn-primary mt-8 h-12 rounded-full px-8 text-base" onClick={() => navigate('/register')}>
              Create Your Account Now
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}

import Navbar from "./_components/Navbar.tsx";
import Hero from "./_components/Hero.tsx";
import StatsBar from "./_components/StatsBar.tsx";
import Features from "./_components/Features.tsx";
import HowItWorks from "./_components/HowItWorks.tsx";
import AdSpy from "./_components/AdSpy.tsx";
import Testimonials from "./_components/Testimonials.tsx";
import Pricing from "./_components/Pricing.tsx";
import FAQ from "./_components/FAQ.tsx";
import FinalCTA from "./_components/FinalCTA.tsx";
import Footer from "./_components/Footer.tsx";
import { usePostLoginRedirect } from "@/hooks/use-post-login-redirect.ts";

export default function Index() {
  usePostLoginRedirect();
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <Hero />
      <StatsBar />
      <Features />
      <HowItWorks />
      <AdSpy />
      <Testimonials />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}

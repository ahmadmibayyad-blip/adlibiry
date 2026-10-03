import { useEffect } from "react";
import Navbar from "./_components/Navbar.tsx";
import Hero from "./_components/Hero.tsx";
import StatsBar from "./_components/StatsBar.tsx";
import Features from "./_components/Features.tsx";
import HowItWorks from "./_components/HowItWorks.tsx";
import AdSpy from "./_components/AdSpy.tsx";
import Pricing from "./_components/Pricing.tsx";
import FAQ from "./_components/FAQ.tsx";
import FinalCTA from "./_components/FinalCTA.tsx";
import Footer from "./_components/Footer.tsx";
import { usePostLoginRedirect } from "@/hooks/use-post-login-redirect.ts";

export default function Index() {
  usePostLoginRedirect();
  // Arriving from another page via /#pricing etc.: scroll once the section exists.
  useEffect(() => {
    if (!window.location.hash) return;
    const t = setTimeout(() => document.querySelector(window.location.hash)?.scrollIntoView({ behavior: "smooth" }), 150);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <Navbar />
      <Hero />
      <StatsBar />
      <Features />
      <HowItWorks />
      <AdSpy />
      <Pricing />
      <FAQ />
      <FinalCTA />
      <Footer />
    </div>
  );
}

import Logo from "@/components/Logo.tsx";
import { Link } from "react-router-dom";

// Product links open the app (signed-out visitors go to sign-in first);
// the others open the info pages in src/pages/info.
const footerLinks: Record<string, { label: string; to: string }[]> = {
  Product: [
    { label: "Ad Spy", to: "/dashboard/ad-spy" },
    { label: "Product Research", to: "/dashboard/research" },
    { label: "Store Tracker", to: "/dashboard/stores" },
    { label: "Market Intelligence", to: "/dashboard" },
    { label: "AI Scoring", to: "/dashboard/winners" },
    { label: "Creative Library", to: "/dashboard/hooks" },
  ],
  Company: [
    { label: "About", to: "/about" },
    { label: "Blog", to: "/blog" },
    { label: "Careers", to: "/careers" },
    { label: "Press", to: "/press" },
    { label: "Partners", to: "/partners" },
  ],
  Support: [
    { label: "Help Center", to: "/help" },
    { label: "Data & methodology", to: "/methodology" },
    { label: "Documentation", to: "/docs" },
    { label: "Community", to: "/community" },
    { label: "Status Page", to: "/status" },
  ],
  Legal: [
    { label: "Privacy Policy", to: "/privacy" },
    { label: "Terms of Service", to: "/terms" },
    { label: "Cookie Policy", to: "/cookies" },
    { label: "GDPR", to: "/gdpr" },
  ],
};

const platforms = ["Facebook Ads", "Instagram Ads", "TikTok Ads", "Shopify Stores"];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card/30 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <a href="/" className="inline-flex mb-4 cursor-pointer" aria-label="AdSpy Pro home">
              <Logo size={24} className="text-lg" />
            </a>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed mb-5">
              The professional ad intelligence platform for serious dropshippers. Real data, honest estimates, zero BS.
            </p>
            <div className="flex flex-wrap gap-2">
              {platforms.map((p) => (
                <span
                  key={p}
                  className="text-xs bg-muted text-muted-foreground px-2.5 py-1 rounded-full"
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="text-sm font-semibold mb-4">{category}</h4>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.label}>
                    <Link
                      to={link.to}
                      onClick={() => window.scrollTo(0, 0)}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {year} AdSpy Pro. All rights reserved.</span>
          <span>Made for ecommerce sellers worldwide 🌍</span>
        </div>
      </div>
    </footer>
  );
}

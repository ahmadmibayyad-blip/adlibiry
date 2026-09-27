import { Zap } from "lucide-react";

const footerLinks = {
  Product: ["Ad Spy", "Product Research", "Store Tracker", "Market Intelligence", "AI Scoring", "Creative Library"],
  Company: ["About", "Blog", "Careers", "Press", "Partners"],
  Support: ["Help Center", "Documentation", "Community", "Status Page"],
  Legal: ["Privacy Policy", "Terms of Service", "Cookie Policy", "GDPR"],
};

const platforms = ["Facebook Ads", "TikTok Ads", "Pinterest Ads", "Shopify Stores"];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-card/30 pt-16 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-8 mb-12">
          {/* Brand */}
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <a href="/" className="flex items-center gap-2 mb-4 cursor-pointer">
              <div className="w-8 h-8 bg-primary rounded-lg flex items-center justify-center">
                <Zap className="w-4 h-4 text-primary-foreground" />
              </div>
              <span className="text-lg font-bold">
                AdSpy<span className="text-primary">Pro</span>
              </span>
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
                  <li key={link}>
                    <a
                      href="#"
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {link}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="border-t border-border pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>© {year} WinningHunter. All rights reserved.</span>
          <span>Made for ecommerce sellers worldwide 🌍</span>
        </div>
      </div>
    </footer>
  );
}

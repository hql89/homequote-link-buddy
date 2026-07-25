import { Link } from "react-router-dom";
import { Wrench } from "lucide-react";
import { SITE_NAME, SITE_REGION, SFV_DIRECTORY_CITIES } from "@/lib/constants";

/**
 * Every link here is verified to resolve to a real route. The previous footer
 * pointed at /services/hvac, /services/landscaping, /services/electrical and
 * /plumbers — none of which exist — and described the service area as the
 * Santa Clarita Valley, left over from before the San Fernando Valley pivot.
 */
export function Footer() {
  return (
    <footer className="border-t bg-primary text-primary-foreground">
      <div className="container py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link to="/" className="flex items-center gap-2 mb-3" aria-label={`${SITE_NAME} home`}>
              <Wrench className="h-5 w-5 text-accent" aria-hidden="true" />
              <span className="font-serif font-bold text-lg">{SITE_NAME}</span>
            </Link>
            <p className="text-sm text-primary-foreground/70">
              A local directory of independent home service businesses across the {SITE_REGION}.
            </p>
          </div>

          <nav aria-label="Browse">
            <h4 className="font-semibold mb-3 font-sans text-sm uppercase tracking-wider text-primary-foreground/50">Browse</h4>
            <ul className="space-y-1 text-sm text-primary-foreground/70">
              <li><Link to="/directory" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">All Cities</Link></li>
              <li><Link to="/blog" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">Blog</Link></li>
              <li><Link to="/faq" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">FAQ</Link></li>
            </ul>
          </nav>

          <div role="region" aria-label="Service Areas">
            <h4 className="font-semibold mb-3 font-sans text-sm uppercase tracking-wider text-primary-foreground/50">Service Areas</h4>
            <ul className="space-y-1 text-sm text-primary-foreground/70">
              {SFV_DIRECTORY_CITIES.map((city) => (
                <li key={city}>{city}</li>
              ))}
            </ul>
          </div>

          <nav aria-label="Resources">
            <h4 className="font-semibold mb-3 font-sans text-sm uppercase tracking-wider text-primary-foreground/50">Resources</h4>
            <ul className="space-y-1 text-sm text-primary-foreground/70">
              <li><Link to="/feedback" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">Feedback</Link></li>
              <li><Link to="/privacy" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">Privacy Policy</Link></li>
              <li><Link to="/terms" className="hover:underline focus:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded">Terms of Service</Link></li>
            </ul>
          </nav>
        </div>
        <div className="mt-8 border-t border-primary-foreground/10 pt-6 text-center text-xs text-primary-foreground/40">
          © {new Date().getFullYear()} {SITE_NAME}. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

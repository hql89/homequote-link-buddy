import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { 
  Phone, Wrench, HelpCircle, BookOpen, DollarSign, Users, User, Menu, 
  LogOut, LayoutDashboard, UserCircle 
} from "lucide-react";
import { trackClick } from "@/services/analyticsService";
import { useAuth } from "@/hooks/useAuth";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { useIsProvider } from "@/hooks/useIsProvider";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

interface HeaderProps {
  /**
   * Strips marketplace chrome — our own phone CTA and the Providers/Pricing
   * nav — so a directory listing page reads as the business's own page
   * rather than a HomeQuoteLink page selling next to their content. A
   * business owner should never see us competing for the same call on a
   * page carrying their name.
   */
  minimal?: boolean;
}

export function Header({ minimal = false }: HeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { isAdmin } = useIsAdmin();
  const { isProvider } = useIsProvider();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/");
      setMobileOpen(false);
    } catch (error) {
      console.error("Error signing out:", error);
    }
  };

  const navLinks = minimal
    ? []
    : [
        { to: "/providers", label: "Providers", icon: Users, track: "header_providers" },
        { to: "/cost-guides", label: "Pricing", icon: DollarSign, track: "header_pricing" },
        { to: "/blog", label: "Blog", icon: BookOpen, track: "header_blog" },
        { to: "/faq", label: "FAQ", icon: HelpCircle, track: "header_faq" },
      ];

  const authLinks = [];
  if (user) {
    if (isAdmin) {
      authLinks.push({ to: "/admin", label: "Admin Panel", icon: LayoutDashboard, track: "header_admin" });
    }
    if (isProvider) {
      authLinks.push({ to: "/provider/dashboard", label: "Dashboard", icon: LayoutDashboard, track: "header_provider" });
    }
    authLinks.push({ to: "/account", label: "Account", icon: UserCircle, track: "header_account" });
  } else {
    authLinks.push({ to: "/login", label: "Login", icon: User, track: "header_login" });
  }

  const allLinks = [...navLinks, ...authLinks];

  return (
    <header className="sticky top-0 z-50 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/60">
      <div className="container flex h-16 items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={() => trackClick("header_logo")}>
          <Wrench className="h-6 w-6 text-accent" aria-hidden="true" />
          <span className="text-lg font-bold text-primary font-serif">HomeQuoteLink</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Main navigation" className="hidden md:flex items-center gap-4">
          {allLinks.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-label={link.label}
              aria-current={location.pathname === link.to ? "page" : undefined}
              onClick={() => trackClick(link.track)}
              className={`flex items-center gap-1 text-sm font-medium transition-colors hover:text-primary ${
                location.pathname === link.to ? "text-primary font-semibold" : "text-muted-foreground"
              }`}
            >
              <link.icon className="h-4 w-4" aria-hidden="true" />
              <span>{link.label}</span>
            </Link>
          ))}
          
          {user && (
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleSignOut}
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-primary"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>Logout</span>
            </Button>
          )}

          {!minimal && (
            <a
              href="tel:+13108613314"
              aria-label="Call us at (310) 861-3314"
              onClick={() => trackClick("header_phone_call")}
              className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              <span>(310) 861-3314</span>
            </a>
          )}
        </nav>

        {/* Mobile: phone + hamburger */}
        <div className="flex items-center gap-2 md:hidden">
          {!minimal && (
            <a
              href="tel:+13108613314"
              aria-label="Call us at (310) 861-3314"
              onClick={() => trackClick("header_phone_call")}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent/90"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              <span>Call Now</span>
            </a>
          )}

          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Open navigation menu"
                aria-expanded={mobileOpen}
              >
                <Menu className="h-5 w-5" aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 bg-card">
              <SheetTitle className="sr-only">Navigation menu</SheetTitle>
              <nav aria-label="Mobile navigation" className="flex flex-col gap-1 mt-8">
                {allLinks.map((link) => (
                  <SheetClose asChild key={link.to}>
                    <Link
                      to={link.to}
                      aria-current={location.pathname === link.to ? "page" : undefined}
                      onClick={() => {
                        trackClick(link.track);
                        setMobileOpen(false);
                      }}
                      className={`flex items-center gap-3 rounded-md px-3 py-3 text-base font-medium transition-colors hover:bg-muted ${
                        location.pathname === link.to
                          ? "bg-accent/10 text-accent font-semibold"
                          : "text-foreground"
                      }`}
                    >
                      <link.icon className="h-5 w-5 text-accent" aria-hidden="true" />
                      {link.label}
                    </Link>
                  </SheetClose>
                ))}

                {user && (
                  <Button
                    variant="ghost"
                    onClick={handleSignOut}
                    className="flex items-center justify-start gap-3 rounded-md px-3 py-3 text-base font-medium text-foreground hover:bg-muted"
                  >
                    <LogOut className="h-5 w-5 text-accent" aria-hidden="true" />
                    Logout
                  </Button>
                )}

                {!minimal && (
                  <>
                    <div className="my-3 border-t" />
                    <SheetClose asChild>
                      <a
                        href="tel:+13108613314"
                        aria-label="Call us at (310) 861-3314"
                        onClick={() => trackClick("header_phone_call")}
                        className="flex items-center gap-3 rounded-md px-3 py-3 text-base font-semibold text-accent transition-colors hover:bg-muted"
                      >
                        <Phone className="h-5 w-5" aria-hidden="true" />
                        (310) 861-3314
                      </a>
                    </SheetClose>
                  </>
                )}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, Phone, Star, Wrench } from "lucide-react";
import { isFeatured, parseServices, type PublicBusinessListing } from "@/integrations/supabase/directory";

const MAX_SERVICES_SHOWN = 3;

/**
 * One business row on a city index. Featured listings get a highlighted border
 * and badge — the visible half of the paid tier, the other half being their
 * position in the list (see DirectoryCity's ordering).
 */
export function DirectoryBusinessCard({ business }: { business: PublicBusinessListing }) {
  const services = parseServices(business.services);
  const featured = isFeatured(business);
  const extraServices = services.length - MAX_SERVICES_SHOWN;

  return (
    <li
      className={`rounded-lg border bg-card p-5 transition hover:shadow-md ${
        featured ? "border-amber-400 ring-1 ring-amber-200" : "border-border"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        {featured && (
          <Badge className="gap-1 bg-amber-500 text-amber-950 hover:bg-amber-500">
            <Star className="h-3 w-3 fill-current" aria-hidden="true" />
            Featured
          </Badge>
        )}
        {business.is_claimed && (
          <Badge className="gap-1 bg-green-600 hover:bg-green-600">
            <BadgeCheck className="h-3 w-3" aria-hidden="true" />
            Verified owner
          </Badge>
        )}
      </div>

      <h3 className="mt-2 text-lg font-semibold">
        <Link
          to={`/directory/${business.city_slug}/${business.slug}`}
          className="hover:underline underline-offset-4"
        >
          {business.business_name}
        </Link>
      </h3>

      {services.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Wrench className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {services.slice(0, MAX_SERVICES_SHOWN).join(" · ")}
          {extraServices > 0 && ` +${extraServices} more`}
        </p>
      )}

      {business.phone && (
        <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {business.phone}
        </p>
      )}
    </li>
  );
}

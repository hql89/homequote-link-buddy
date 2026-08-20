import { Link } from "react-router-dom";
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight } from "lucide-react";
import type { ReadinessCheck, ReadinessLevel, ReadinessResult } from "@/lib/outreachReadiness";

/**
 * The "where am I and what's next" panel for outreach.
 *
 * Every row states the current situation in words and, when something can be
 * done about it, links to the exact screen that does it. Deliberately no
 * buttons that act from here: the actions live on pages that carry their own
 * confirmations (turning on daily sending asks first, for good reason), and
 * duplicating them here would route around that.
 */

const LEVEL_STYLES: Record<ReadinessLevel, { banner: string; icon: typeof CheckCircle2; iconClass: string }> = {
  ok: {
    banner: "border-emerald-600/30 bg-emerald-500/5",
    icon: CheckCircle2,
    iconClass: "text-emerald-600",
  },
  attention: {
    banner: "border-yellow-600/30 bg-yellow-500/5",
    icon: AlertTriangle,
    iconClass: "text-yellow-600",
  },
  blocked: {
    banner: "border-destructive/30 bg-destructive/5",
    icon: XCircle,
    iconClass: "text-destructive",
  },
};

function CheckRow({ check }: { check: ReadinessCheck }) {
  const { icon: Icon, iconClass } = LEVEL_STYLES[check.level];

  return (
    <li className="flex items-start gap-3 py-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClass}`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{check.label}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{check.detail}</p>
      </div>
      {check.action && (
        <Link
          to={check.action.href}
          className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm text-accent hover:underline"
        >
          {check.action.text}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      )}
    </li>
  );
}

export function OutreachReadiness({ result }: { result: ReadinessResult }) {
  const { banner, icon: Icon, iconClass } = LEVEL_STYLES[result.level];

  return (
    <section className={`mt-6 rounded-lg border p-5 ${banner}`} aria-label="Outreach status">
      <div className="flex items-start gap-3">
        <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${iconClass}`} aria-hidden="true" />
        <div>
          <h2 className="font-semibold font-sans text-foreground">{result.headline}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{result.sublabel}</p>
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/60 border-t border-border/60">
        {result.checks.map((check) => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ul>
    </section>
  );
}

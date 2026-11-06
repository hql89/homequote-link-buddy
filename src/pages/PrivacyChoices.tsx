import { useEffect, useState } from "react";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { Button } from "@/components/ui/button";
import { ShieldCheck, Check } from "lucide-react";
import {
  isTrackingOptedOut,
  optOutReason,
  writeTrackingChoice,
  readTrackingChoice,
} from "@/lib/trackingChoice";

/**
 * The self-serve half of the California privacy rights the policy describes.
 *
 * The policy already offers an email request path, which is a right rather
 * than a control — 45 days and a human in the loop. CPRA expects opting out
 * of sharing for advertising to be something a visitor can simply do, so this
 * page does it, immediately, on their own device.
 *
 * Deliberate choices in the copy:
 *
 *  - It never claims the opt-out reaches Google or Meta retroactively. It
 *    stops this site reporting to them from now on; data already shared is
 *    addressed by the email path, which is still offered here.
 *  - A browser sending Global Privacy Control is shown as already opted out,
 *    with the toggle disabled rather than hidden — a visitor who has set GPC
 *    deserves to see it was honoured, not to find a control that implies it
 *    was not.
 *  - When localStorage is unavailable the page says the choice cannot be
 *    remembered, instead of showing a toggle that silently forgets.
 */
export default function PrivacyChoices() {
  const [optedOut, setOptedOut] = useState(false);
  const [reason, setReason] = useState<"gpc" | "choice" | null>(null);
  const [storageWorks, setStorageWorks] = useState(true);
  const [justSaved, setJustSaved] = useState(false);

  useEffect(() => {
    setOptedOut(isTrackingOptedOut());
    setReason(optOutReason());
    try {
      const probe = "hql_storage_probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
    } catch {
      setStorageWorks(false);
    }
  }, []);

  function choose(next: "opted_out" | "opted_in") {
    writeTrackingChoice(next);
    // Re-read rather than assume: a live GPC signal keeps the visitor opted
    // out even if they press "allow", and the page must show what is true.
    setOptedOut(isTrackingOptedOut());
    setReason(optOutReason());
    setJustSaved(true);
  }

  const gpc = reason === "gpc";

  return (
    <>
      <PageMeta
        title="Your Privacy Choices | Valley Home Pros"
        description="Opt out of having your browsing shared with Google and Meta for advertising."
      />
      <Header />
      <main className="container py-16 max-w-3xl">
        <h1 className="text-3xl font-bold mb-2 font-sans">Your Privacy Choices</h1>
        <p className="text-sm text-muted-foreground mb-8">
          For California residents, and anyone else who would rather not be tracked.
        </p>

        <section className="mb-8">
          <p className="text-muted-foreground leading-relaxed">
            This site uses Google Analytics and the Meta Pixel. They record the pages you visit,
            and if you submit a request we tell Meta that a request was made, along with the type
            of service and the city — never your name, phone number, email address or the
            description of your project.
          </p>
          <p className="text-muted-foreground leading-relaxed mt-4">
            California law treats sharing that information for advertising as a "sale" or
            "sharing" even though no money changes hands. You can tell us to stop, right here.
          </p>
        </section>

        <section className="rounded-lg border border-border bg-card p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck
              className={`mt-0.5 h-5 w-5 shrink-0 ${optedOut ? "text-green-600" : "text-muted-foreground"}`}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold" data-testid="choice-status">
                {optedOut
                  ? "You are opted out on this browser."
                  : "You are not currently opted out."}
              </p>

              {gpc && (
                <p className="mt-2 text-sm text-muted-foreground">
                  Your browser is sending a Global Privacy Control signal, and we honour it. You
                  do not need to do anything else here. If you turn that signal off, this page
                  will let you choose again.
                </p>
              )}

              {!gpc && (
                <p className="mt-2 text-sm text-muted-foreground">
                  {optedOut
                    ? "We have stopped sharing your browsing on this site with Google and Meta. This applies from now on — to undo anything already shared, use the email request below."
                    : "Opting out stops this site sharing your browsing with Google and Meta from that moment on."}
                </p>
              )}

              {!storageWorks && (
                <p className="mt-2 text-sm text-destructive">
                  Your browser is blocking site storage, so a choice made here cannot be
                  remembered after you leave the page. Use the email request below instead, or
                  turn on a Global Privacy Control signal in your browser.
                </p>
              )}

              {!gpc && (
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button
                    onClick={() => choose(optedOut ? "opted_in" : "opted_out")}
                    variant={optedOut ? "outline" : "default"}
                  >
                    {optedOut ? "Allow tracking again" : "Do not sell or share my information"}
                  </Button>
                  {justSaved && (
                    <span className="flex items-center gap-1.5 text-sm text-green-700">
                      <Check className="h-4 w-4" aria-hidden="true" />
                      Saved — reload any open pages for it to take full effect.
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>

        <section className="mt-8">
          <h2 className="text-xl font-semibold mb-3 font-sans">Two things this does not do</h2>
          <ul className="list-disc space-y-2 pl-5 text-muted-foreground leading-relaxed">
            <li>
              It applies to this browser only. If you use another device or browser, set it
              there too — we have no account to attach the choice to, which is also why we
              cannot identify you.
            </li>
            <li>
              It does not reach back and remove information already shared with Google or Meta.
              For that, or to ask what we hold about you, email{" "}
              <a href="mailto:privacy@homequotelink.com" className="underline text-primary">
                privacy@homequotelink.com
              </a>
              . We respond within 45 days, and we will not treat you differently for asking.
            </li>
          </ul>
        </section>
      </main>
      <Footer />
    </>
  );
}

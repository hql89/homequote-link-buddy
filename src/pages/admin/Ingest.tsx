import { useState, useEffect, useCallback, useRef } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { directoryDb, setBusinessPublished } from "@/integrations/supabase/directory";
import type { Json } from "@/integrations/supabase/types";
import { parseCslbCsv, type CslbCandidate } from "@/lib/cslb";
import { SFV_DIRECTORY_CITIES } from "@/lib/constants";
import { Loader2, Upload, Play, CheckCircle2, Eye } from "lucide-react";

const SETTING_KEY = "ingest_config";
const UPLOAD_CHUNK = 500;

interface IngestConfig {
  daily_limit?: number;
  enabled?: boolean;
  cities?: string[];
}

interface QueueCounts {
  pending: number;
  ingested: number;
  skipped: number;
  failed: number;
}

interface UnpublishedBusiness {
  id: string;
  business_name: string;
  city: string;
  city_slug: string;
  slug: string;
  phone: string | null;
  license_number: string | null;
}

export default function IngestPage() {
  const fileRef = useRef<HTMLInputElement>(null);

  const [config, setConfig] = useState<IngestConfig>({ daily_limit: 25, enabled: true, cities: [] });
  const [counts, setCounts] = useState<QueueCounts>({ pending: 0, ingested: 0, skipped: 0, failed: 0 });
  const [unpublished, setUnpublished] = useState<UnpublishedBusiness[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [running, setRunning] = useState(false);
  const [publishing, setPublishing] = useState<string | null>(null);
  const [lastImport, setLastImport] = useState<string | null>(null);

  const cities = config.cities?.length ? config.cities : [...SFV_DIRECTORY_CITIES];

  const load = useCallback(async () => {
    setLoading(true);
    const [cfgRes, queueRes, bizRes] = await Promise.all([
      supabase.from("admin_settings").select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle(),
      directoryDb.from("ingest_queue").select("status"),
      directoryDb
        .from("businesses")
        .select("id, business_name, city, city_slug, slug, phone, license_number")
        .eq("is_published", false)
        .order("created_at", { ascending: false })
        .limit(200),
    ]);

    if (cfgRes.data?.setting_value) {
      setConfig({ daily_limit: 25, enabled: true, cities: [], ...(cfgRes.data.setting_value as IngestConfig) });
    }

    const tally: QueueCounts = { pending: 0, ingested: 0, skipped: 0, failed: 0 };
    for (const r of (queueRes.data ?? []) as { status: keyof QueueCounts }[]) {
      if (r.status in tally) tally[r.status]++;
    }
    setCounts(tally);

    if (bizRes.error) {
      toast({ title: "Couldn't load pending listings", description: bizRes.error.message, variant: "destructive" });
    } else {
      setUnpublished((bizRes.data ?? []) as UnpublishedBusiness[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function saveConfig(next: IngestConfig) {
    const merged = { ...config, ...next };
    setConfig(merged);
    const { error } = await supabase
      .from("admin_settings")
      .upsert({ setting_key: SETTING_KEY, setting_value: merged as unknown as Json }, { onConflict: "setting_key" });
    if (error) toast({ title: "Save failed", description: error.message, variant: "destructive" });
  }

  async function handleFile(file: File) {
    setUploading(true);
    setLastImport(null);
    try {
      const text = await file.text();
      const { candidates, rejected, totalRows, statusSample, detectedHeaders } = parseCslbCsv(text, cities);

      if (candidates.length === 0) {
        const why = Object.entries(rejected).map(([r, n]) => `${n} ${r}`).join(", ");
        const statusHint = statusSample.length > 0 ? ` Status values found: ${statusSample.join(", ")}.` : "";
        const headerHint = detectedHeaders.length > 0 ? ` Headers: ${detectedHeaders.slice(0, 10).join(", ")}.` : "";
        toast({
          title: "Nothing to import",
          description: totalRows === 0
            ? "That file had no data rows — check it's the CSLB export."
            : `All ${totalRows} rows were filtered out (${why}).${statusHint}${headerHint}`,
          variant: "destructive",
        });
        return;
      }

      let inserted = 0, duplicates = 0;
      for (let i = 0; i < candidates.length; i += UPLOAD_CHUNK) {
        const chunk: CslbCandidate[] = candidates.slice(i, i + UPLOAD_CHUNK);
        const { data, error } = await supabase.functions.invoke("import-ingest-queue", {
          body: { candidates: chunk },
        });
        if (error || !data?.success) {
          throw new Error(data?.error ?? error?.message ?? "Import failed.");
        }
        inserted += data.inserted ?? 0;
        duplicates += data.duplicates ?? 0;
      }

      const rejectedTotal = Object.values(rejected).reduce((a, b) => a + b, 0);
      setLastImport(
        `${totalRows} rows read · ${inserted} queued · ${duplicates} already queued · ${rejectedTotal} filtered out`,
      );
      toast({ title: "Import complete", description: `${inserted} new businesses queued.` });
      await load();
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Could not import that file.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function runNow() {
    setRunning(true);
    try {
      const { data: session } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("process-ingest-queue", {
        body: {},
        headers: { Authorization: `Bearer ${session?.session?.access_token}` },
      });
      if (error || !data?.success) throw new Error(data?.error ?? error?.message ?? "Run failed.");

      toast({
        title: data.disabled ? "Engine is off" : "Ingestion run complete",
        description: data.disabled
          ? "Turn the engine on to process the queue."
          : `${data.ingested} ingested · ${data.skipped} skipped · ${data.failed} failed`,
      });
      await load();
    } catch (err) {
      toast({
        title: "Run failed",
        description: err instanceof Error ? err.message : "Could not run the ingestion job.",
        variant: "destructive",
      });
    } finally {
      setRunning(false);
    }
  }

  async function publish(id: string) {
    setPublishing(id);
    const error = await setBusinessPublished(id, true);
    if (error) {
      toast({ title: "Publish failed", description: error.message, variant: "destructive" });
    } else {
      setUnpublished((prev) => prev.filter((b) => b.id !== id));
      toast({ title: "Listing published" });
    }
    setPublishing(null);
  }

  return (
    <AdminLayout>
      <PageMeta title="Ingestion | Valley Home Pros" description="Business ingestion engine." noIndex />

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold font-serif text-primary">Business Ingestion</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Import a CSLB licence export, then let the engine add businesses gradually.
            Ingested listings stay unpublished with outreach paused until you release them.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground" role="status" aria-live="polite">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading…
          </div>
        ) : (
          <>
            {/* ── Queue status ─────────────────────────────────────────── */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {([
                ["Pending", counts.pending],
                ["Ingested", counts.ingested],
                ["Skipped", counts.skipped],
                ["Failed", counts.failed],
              ] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg border bg-card p-4">
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="mt-1 text-2xl font-bold">{n}</p>
                </div>
              ))}
            </div>

            {/* ── Import ───────────────────────────────────────────────── */}
            <div className="max-w-2xl space-y-4 rounded-lg border bg-card p-6">
              <h2 className="flex items-center gap-2 font-semibold font-sans">
                <Upload className="h-4 w-4" aria-hidden="true" />
                Import a CSLB export
              </h2>
              <p className="text-xs text-muted-foreground">
                Download a licence list from the{" "}
                <a
                  href="https://www.cslb.ca.gov/onlineservices/dataportal/ContractorList"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4"
                >
                  CSLB Data Portal
                </a>{" "}
                (free, no account) and upload the CSV. Rows are filtered to active licences,
                the categories we list, and these cities: {cities.join(", ")}.
              </p>

              <Input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              {uploading && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Parsing and queueing…
                </p>
              )}
              {lastImport && (
                <p className="flex items-start gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
                  {lastImport}
                </p>
              )}
            </div>

            {/* ── Engine controls ──────────────────────────────────────── */}
            <div className="max-w-2xl space-y-5 rounded-lg border bg-card p-6">
              <h2 className="font-semibold font-sans">Engine</h2>

              <div className="flex items-center justify-between">
                <div>
                  <Label>Enabled</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    When off, scheduled runs do nothing and the queue simply waits.
                  </p>
                </div>
                <Switch
                  checked={config.enabled !== false}
                  onCheckedChange={(v) => saveConfig({ enabled: v })}
                  aria-label="Enable ingestion engine"
                />
              </div>

              <div>
                <Label htmlFor="daily-limit">Businesses per run</Label>
                <Input
                  id="daily-limit"
                  type="number"
                  min={1}
                  max={500}
                  className="mt-1 max-w-[140px]"
                  value={config.daily_limit ?? 25}
                  onChange={(e) => setConfig({ ...config, daily_limit: Number(e.target.value) })}
                  onBlur={(e) => saveConfig({ daily_limit: Math.min(500, Math.max(1, Number(e.target.value) || 25)) })}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Ratchet this up or down any time — it takes effect on the next run, no deploy needed.
                </p>
              </div>

              <div>
                <Button onClick={runNow} disabled={running || counts.pending === 0}>
                  {running ? (
                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />Running…</>
                  ) : (
                    <><Play className="mr-2 h-4 w-4" aria-hidden="true" />Run now</>
                  )}
                </Button>
                {counts.pending === 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Nothing pending — import a CSLB export first.
                  </p>
                )}
              </div>
            </div>

            {/* ── Review + publish ─────────────────────────────────────── */}
            <div className="rounded-lg border bg-card p-6">
              <h2 className="font-semibold font-sans">
                Ingested, awaiting publication{" "}
                {unpublished.length > 0 && <Badge variant="secondary">{unpublished.length}</Badge>}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                These are live in the database but hidden from the directory, with outreach paused.
                Publishing makes the listing page public; it does not send any email.
              </p>

              {unpublished.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing awaiting publication.
                </p>
              ) : (
                <div className="mt-4 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Business</TableHead>
                        <TableHead>City</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Licence</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unpublished.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{b.business_name}</TableCell>
                          <TableCell>{b.city}</TableCell>
                          <TableCell>{b.phone}</TableCell>
                          <TableCell className="font-mono text-xs">{b.license_number ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button asChild variant="ghost" size="sm">
                                <a
                                  href={`/directory/${b.city_slug}/${b.slug}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Eye className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                                  Preview
                                </a>
                              </Button>
                              <Button size="sm" onClick={() => publish(b.id)} disabled={publishing === b.id}>
                                {publishing === b.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                                ) : (
                                  "Publish"
                                )}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
}

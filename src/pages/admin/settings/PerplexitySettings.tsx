import { useState, useEffect, useCallback } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { Sparkles, Loader2, CheckCircle2, AlertCircle } from "lucide-react";

const SETTING_KEY = "perplexity_config";

interface PerplexityConfig {
  /** Never sent back to the browser once saved — see `maskKey`. */
  api_key?: string;
  /** Last 4 characters, safe to display so you can tell which key is stored. */
  key_hint?: string;
  enabled?: boolean;
  updated_at?: string;
}

/** Keeps only a non-reversible tail for display. */
function maskKey(key: string): string {
  const tail = key.trim().slice(-4);
  return tail ? `••••••••${tail}` : "";
}

export function PerplexitySettings() {
  const [keyInput, setKeyInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  /**
   * Loads only the non-secret fields. The stored key is deliberately never
   * selected into component state, so it can't end up in a screenshot, a React
   * devtools dump, or an error report.
   */
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", SETTING_KEY)
      .maybeSingle();

    if (error) {
      toast({ title: "Couldn't load Perplexity settings", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    const cfg = (data?.setting_value ?? {}) as PerplexityConfig;
    setHint(cfg.key_hint ?? null);
    setEnabled(Boolean(cfg.enabled));
    setUpdatedAt(cfg.updated_at ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save(nextEnabled: boolean, nextKey?: string) {
    setSaving(true);
    try {
      // Read the existing row so toggling `enabled` doesn't wipe a stored key.
      const { data: existing } = await supabase
        .from("admin_settings")
        .select("setting_value")
        .eq("setting_key", SETTING_KEY)
        .maybeSingle();

      const current = (existing?.setting_value ?? {}) as PerplexityConfig;
      const trimmed = nextKey?.trim();

      const next: PerplexityConfig = {
        ...current,
        enabled: nextEnabled,
        updated_at: new Date().toISOString(),
        ...(trimmed ? { api_key: trimmed, key_hint: maskKey(trimmed) } : {}),
      };

      const { error } = await supabase
        .from("admin_settings")
        .upsert(
          { setting_key: SETTING_KEY, setting_value: next as unknown as Json },
          { onConflict: "setting_key" },
        );
      if (error) throw error;

      setEnabled(nextEnabled);
      if (trimmed) {
        setHint(maskKey(trimmed));
        setKeyInput(""); // never leave the raw key sitting in the field
      }
      setUpdatedAt(next.updated_at ?? null);
      toast({
        title: trimmed ? "API key saved" : "Settings saved",
        description: trimmed ? "Enrichment can now use Perplexity." : undefined,
      });
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Could not save settings.",
        variant: "destructive",
      });
      setEnabled(!nextEnabled);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-lg border bg-card p-6 mb-6 space-y-5">
      <h2 className="font-semibold font-sans flex items-center gap-2">
        <Sparkles className="h-4 w-4" />
        Perplexity (business enrichment)
      </h2>

      <p className="text-xs text-muted-foreground">
        Used to find a business's official website during ingestion. Perplexity is only ever
        asked for a URL — contact details are read from the business's own site, never from
        the model's answer.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground" role="status" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading…
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            {hint ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                <span>
                  Key configured <span className="font-mono text-muted-foreground">{hint}</span>
                </span>
              </>
            ) : (
              <>
                <AlertCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                <span className="text-muted-foreground">No key configured</span>
              </>
            )}
          </div>

          <div>
            <Label htmlFor="pplx-key">{hint ? "Replace API key" : "API key"}</Label>
            <div className="mt-1 flex gap-2">
              <Input
                id="pplx-key"
                type="password"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={hint ? "Enter a new key to replace the stored one" : "pplx-…"}
                autoComplete="off"
                spellCheck={false}
              />
              <Button
                onClick={() => save(enabled, keyInput)}
                disabled={saving || keyInput.trim().length < 8}
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : "Save"}
              </Button>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Write-only: once saved, the key is never sent back to this page. Replace it by
              entering a new one.
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Enable enrichment</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                When off, ingestion still runs — businesses are listed with their phone number
                and no website lookup is attempted.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(v) => save(v)}
              disabled={saving || !hint}
              aria-label="Enable Perplexity enrichment"
            />
          </div>

          {updatedAt && (
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </>
      )}
    </div>
  );
}

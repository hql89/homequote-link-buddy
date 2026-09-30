import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, XCircle, X, Loader2 } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { jsonObject } from "@/integrations/supabase/json";
import type { Database } from "@/integrations/supabase/types";
import { toDisplayAlarm, unseenAlarms, type AlarmRecord, type DisplayAlarm } from "@/lib/alarmDisplay";

const SETTING_KEY = "admin_notifications";

type LoadState = "loading" | "ok" | "error";

type RecentAlarmRow = Database["public"]["Functions"]["admin_recent_alarms"]["Returns"][number];

/**
 * Converts one `admin_recent_alarms` row into what {@link toDisplayAlarm} reads.
 *
 * The generated row type is the shape of record here, rather than a hand-written
 * one asserted over it, so renaming a column in the RPC fails the build instead
 * of showing every alarm as unrecognised. Two things it still cannot say:
 *
 * - `error_message` is `job_run_logs.error_message`, which is nullable, but a
 *   `RETURNS TABLE` column always generates as non-null. `toDisplayAlarm`
 *   already falls back when it is null, and this keeps that reachable —
 *   `strict: false` means the generated non-null claim could never have been
 *   checked anyway.
 * - `metadata` generates as `Json`, i.e. any JSON value. It is NOT NULL with a
 *   `'{}'` default and `_shared/alarm.ts` writes an object, so it is read as
 *   one — but checked, not asserted, since `alarm_kind` is looked up on it.
 */
function toAlarmRecord(row: RecentAlarmRow): AlarmRecord {
  return {
    id: row.id,
    errorMessage: row.error_message ?? null,
    metadata: jsonObject(row.metadata),
    createdAt: row.created_at,
  };
}

/**
 * Surfaces raiseAlarm() records on every admin page.
 *
 * Mounted once in AdminLayout, not on any one feature's screen — an alarm
 * about outbound email breaking has nothing to do with whichever admin page
 * happens to be open when it fires, and burying it on one screen is most of
 * how it stayed invisible this long.
 *
 * "Mark as seen" writes a timestamp, not a per-row flag: the next time the
 * SAME condition re-fires, its created_at is newer than that timestamp and it
 * reappears. Dismissing hides the notice, never the problem — the banner's
 * own copy says so, because the two are easy to conflate.
 */
export function AlarmBanner() {
  const [state, setState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alarms, setAlarms] = useState<DisplayAlarm[]>([]);
  const [dismissing, setDismissing] = useState(false);

  const load = useCallback(async () => {
    setState("loading");

    const [alarmsRes, settingsRes] = await Promise.all([
      supabase.rpc("admin_recent_alarms"),
      supabase.from("admin_settings").select("setting_value").eq("setting_key", SETTING_KEY).maybeSingle(),
    ]);

    // A failed read must not render as "nothing to report" — that would
    // recreate the exact invisibility this banner exists to close, just one
    // layer up (the alarm was recorded, but now the read of it fails quietly
    // too). Surfaced as its own error state instead.
    if (alarmsRes.error) {
      setErrorMessage(alarmsRes.error.message);
      setState("error");
      return;
    }

    const seenUpTo = (settingsRes.data?.setting_value as { alarms_seen_up_to?: string } | null)
      ?.alarms_seen_up_to ?? null;

    const records: AlarmRecord[] = (alarmsRes.data ?? []).map(toAlarmRecord);

    setAlarms(unseenAlarms(records.map(toDisplayAlarm), seenUpTo));
    setState("ok");
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function dismissAll() {
    if (alarms.length === 0) return;
    setDismissing(true);

    // Newest alarm's timestamp, not "now": if an alarm landed between the
    // load above and this click, dating the cutoff to "now" would silently
    // mark it seen without it ever having been shown.
    const newestSeen = alarms.reduce(
      (latest, a) => (Date.parse(a.createdAt) > Date.parse(latest) ? a.createdAt : latest),
      alarms[0].createdAt,
    );

    // Merge rather than overwrite: this key may hold other admin-notification
    // preferences later, and clobbering them here would be the same class of
    // bug the outreach_config writes have already been careful to avoid.
    const { data: existing } = await supabase
      .from("admin_settings")
      .select("setting_value")
      .eq("setting_key", SETTING_KEY)
      .maybeSingle();

    // jsonObject, not a cast: spreading a non-object would corrupt the write
    // rather than fail it. `...(null)` is a harmless no-op, but a jsonb column
    // can hold a bare string, and `...("ab")` spreads to `{0:"a",1:"b"}` —
    // which this would then upsert over the real settings row.
    const merged = {
      ...(jsonObject(existing?.setting_value) ?? {}),
      alarms_seen_up_to: newestSeen,
    };

    const { error } = await supabase
      .from("admin_settings")
      .upsert({ setting_key: SETTING_KEY, setting_value: merged }, { onConflict: "setting_key" });

    if (!error) {
      setAlarms([]);
    }
    setDismissing(false);
  }

  if (state === "loading") return null;

  if (state === "error") {
    return (
      <Alert variant="destructive" className="mb-4">
        <XCircle className="h-4 w-4" aria-hidden="true" />
        <AlertTitle>Couldn't check for alerts</AlertTitle>
        <AlertDescription className="font-mono text-xs">{errorMessage}</AlertDescription>
      </Alert>
    );
  }

  if (alarms.length === 0) return null;

  const hasCritical = alarms.some((a) => a.severity === "critical");

  return (
    <Alert
      variant={hasCritical ? "destructive" : "default"}
      className={hasCritical ? "mb-4" : "mb-4 border-yellow-600/40 bg-yellow-500/5 [&>svg]:text-yellow-600"}
    >
      {hasCritical ? (
        <XCircle className="h-4 w-4" aria-hidden="true" />
      ) : (
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
      )}
      <AlertTitle className="flex items-center justify-between gap-4 pr-6">
        <span>{alarms.length === 1 ? "1 alert" : `${alarms.length} alerts`}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={dismissing}
          onClick={dismissAll}
        >
          {dismissing ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <X className="h-3 w-3" aria-hidden="true" />}
          <span className="ml-1">Dismiss</span>
        </Button>
      </AlertTitle>
      <AlertDescription>
        <ul className="space-y-2">
          {alarms.map((a) => (
            <li key={a.id}>
              <p className="font-medium text-foreground">{a.title}</p>
              <p className="text-xs text-muted-foreground">
                {new Date(a.createdAt).toLocaleString()}
                {a.detail && a.detail !== a.title ? ` — ${a.detail}` : ""}
              </p>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Dismissing hides this notice, not the problem — if it happens again, it comes back.
        </p>
      </AlertDescription>
    </Alert>
  );
}

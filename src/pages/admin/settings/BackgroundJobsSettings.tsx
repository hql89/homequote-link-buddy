import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, Clock, CheckCircle2, AlertTriangle, XCircle, RefreshCw, Database, CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { HelpTip } from "@/components/admin/HelpTip";
import { summariseRun, topRejectionReason } from "@/lib/jobRunSummary";
import { classifyCronError, cronErrorMessage } from "@/lib/cronAvailability";

type CronJob = {
  jobid: number;
  jobname: string;
  schedule: string;
  active: boolean;
  command: string;
};

type JobRunLog = {
  id: string;
  job_name: string;
  status: "success" | "failure" | "partial";
  attempts: number;
  duration_ms: number | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

type DatabaseDiagnostics = {
  captured_at: string;
  pg_stat_statements_enabled: boolean;
  active_queries: { pid: number; duration_seconds: number | null; query: string | null }[];
  table_sizes: { relname: string; live_rows: number; dead_rows: number; total_size: string }[];
  job_stats: { jobname: string; active: boolean; last_run_at: string | null; runs_last_24h: number; failures_last_24h: number }[];
  top_queries: { calls: number; total_ms: number; mean_ms: number; query: string | null }[];
};

type ManagedJob = {
  name: string;
  label: string;
  description: string;
  schedule: string;
  /**
   * Set when switching the job on starts something that reaches real people and
   * can't be recalled. Turning such a job *off* is never gated — stopping
   * outbound mail should always be one click.
   */
  confirm?: { title: string; body: string; action: string };
};

// Jobs the admin is allowed to manage from the UI. Every name here must be one
// admin_toggle_cron_job recognises, or enabling it raises 'Unknown job'.
const MANAGED_JOBS: ManagedJob[] = [
  {
    name: "publish-scheduled-posts",
    label: "Publish scheduled blog posts",
    description: "Checks for scheduled posts and publishes any that are due.",
    schedule: "Every 15 minutes",
  },
  {
    name: "send-nurture-emails-hourly",
    label: "Send nurture emails",
    description: "Sends follow-up emails to leads in the nurture pipeline.",
    schedule: "Hourly",
  },
  {
    name: "send-outreach-drip-daily",
    label: "Send outreach emails",
    description:
      "Emails businesses in the directory that haven't been contacted yet, inviting them to claim their listing.",
    schedule: "Daily at 3:00 PM UTC",
    confirm: {
      title: "Start emailing businesses daily?",
      body:
        "This sends cold outreach to real businesses in the directory every day, automatically, with no per-send review. Recipients are people who never asked to hear from you, and a sent email can't be recalled. Only turn this on when the listings and the outreach copy are both ready to be seen.",
      action: "Start sending",
    },
  },
  {
    name: "prune-internal-job-logs-daily",
    label: "Prune internal job logs",
    description: "Keeps cron, request, and job-run logs from growing indefinitely.",
    schedule: "Daily at 3:17 AM UTC",
  },
  {
    name: "email-canary-check",
    label: "Check email delivery (canary)",
    description:
      "Sends a probe email roughly hourly and confirms whether it actually arrived, so a delivery " +
      "outage is caught automatically instead of being discovered by an admin noticing nothing came " +
      "through.",
    schedule: "Checked every 15 minutes",
    confirm: {
      title: "Turn on the email delivery check?",
      body:
        "This needs a separate piece set up outside this admin panel: an automation that watches the " +
        "notification inbox and reports back when a probe email arrives. Until that's set up, every " +
        "probe will correctly report as undelivered — which is expected, not a bug, but it will look " +
        "like a wall of alarms if you're not expecting it.",
      action: "Turn on anyway",
    },
  },
];

export function BackgroundJobsSettings() {
  const qc = useQueryClient();
  const [confirming, setConfirming] = useState<ManagedJob | null>(null);

  const { data: jobs, isLoading, isError, error } = useQuery({
    queryKey: ["admin-cron-jobs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_list_cron_jobs");
      if (error) throw error;
      return (data ?? []) as CronJob[];
    },
    staleTime: 30_000,
    // A missing extension won't fix itself on a second attempt, and each retry
    // holds the panel in its loading state that much longer.
    retry: false,
  });

  // Without a successful read there is no schedule state to report. Rendering a
  // switch as "Off" here would assert something we don't know — pg_cron may not
  // even be installed, in which case nothing is scheduled or schedulable.
  const failure = isError ? classifyCronError(error) : null;

  const {
    data: runs,
    isLoading: runsLoading,
    isError: runsIsError,
    error: runsError,
    refetch: refetchRuns,
    isFetching: runsFetching,
  } = useQuery({
    queryKey: ["admin-job-run-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_recent_job_runs", { p_limit: 25 });
      if (error) throw error;
      return (data ?? []) as JobRunLog[];
    },
    staleTime: 30_000,
  });

  const {
    data: diagnostics,
    isLoading: diagnosticsLoading,
    isError: diagnosticsIsError,
    error: diagnosticsError,
    refetch: refetchDiagnostics,
    isFetching: diagnosticsFetching,
  } = useQuery({
    queryKey: ["admin-database-diagnostics"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("admin_database_diagnostics");
      if (error) throw error;
      return data as unknown as DatabaseDiagnostics;
    },
    staleTime: 30_000,
    // admin_database_diagnostics joins cron.job unconditionally, so it fails the
    // same way and for the same reason as admin_list_cron_jobs when pg_cron is
    // absent — a retry can't succeed where the last one failed for that reason.
    retry: false,
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ jobname, enable }: { jobname: string; enable: boolean }) => {
      const { data, error } = await supabase.rpc("admin_toggle_cron_job", {
        p_jobname: jobname,
        p_enable: enable,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["admin-cron-jobs"] });
      qc.invalidateQueries({ queryKey: ["admin-database-diagnostics"] });
      toast({
        title: vars.enable ? "Job enabled" : "Job disabled",
        // "scheduled", not "running": all this call did was write a cron entry.
        // Two of these jobs post to edge functions that aren't deployed, so
        // claiming they're running would be asserting more than we checked.
        description: `${vars.jobname} is now ${vars.enable ? "scheduled" : "stopped"}.`,
      });
    },
    onError: (err: Error) => {
      // The switch is disabled while the schedule is unreadable, so this mostly
      // catches pg_cron disappearing between page load and click.
      const description =
        classifyCronError(err) === "unavailable"
          ? "The pg_cron extension isn't installed, so there is no scheduler to write to."
          : cronErrorMessage(err);
      toast({ title: "Couldn't change the job", description, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-2xl rounded-lg border bg-card p-6 mb-6 space-y-5">
      <div>
        <h2 className="font-semibold font-sans flex items-center gap-2">
          <Clock className="h-4 w-4" />
          Background Jobs
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          Turn scheduled background tasks on or off. Disabling a job stops it entirely until you turn it back on.
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-4">
          {failure && <CronFailureNotice failure={failure} error={error} />}

          {MANAGED_JOBS.map((meta) => {
            const job = jobs?.find((j) => j.jobname === meta.name);
            const isOn = !!job?.active;
            const isPending =
              toggleMutation.isPending && toggleMutation.variables?.jobname === meta.name;

            return (
              <div
                key={meta.name}
                className="flex items-start justify-between gap-4 rounded-md border bg-background p-4"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Label className="font-medium">{meta.label}</Label>
                    {failure ? (
                      <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                        Status unknown
                      </Badge>
                    ) : isOn ? (
                      <Badge variant="default" className="text-xs">On</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Off</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{meta.description}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    <span className="font-medium">Schedule:</span> {meta.schedule}
                    {job?.schedule && <span className="ml-1 opacity-60">({job.schedule})</span>}
                  </p>
                </div>
                <Switch
                  checked={isOn}
                  disabled={isPending || !!failure}
                  aria-label={`${isOn ? "Disable" : "Enable"} ${meta.label}`}
                  onCheckedChange={(enable) => {
                    // Confirm only on the way on — see ManagedJob.confirm.
                    if (enable && meta.confirm) {
                      setConfirming(meta);
                      return;
                    }
                    toggleMutation.mutate({ jobname: meta.name, enable });
                  }}
                />
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog
        open={!!confirming}
        onOpenChange={(open) => {
          if (!open) setConfirming(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirming?.confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) {
                  toggleMutation.mutate({ jobname: confirming.name, enable: true });
                }
                setConfirming(null);
              }}
            >
              {confirming?.confirm?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="pt-4 border-t">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <Database className="h-3.5 w-3.5" />
              Database diagnostics
              <HelpTip>
                A snapshot, not a live feed — press Refresh to re-read it. Useful when the site feels slow:
                a high active-query count or a table growing unexpectedly fast is usually the cause.
              </HelpTip>
            </h3>
            <p className="text-xs text-muted-foreground">
              Backend health at the moment you last refreshed: queries running now, scheduled job failures,
              which tables are largest, and which queries cost the most time.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["admin-database-diagnostics"] });
              refetchDiagnostics();
            }}
            disabled={diagnosticsFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${diagnosticsFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {diagnosticsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : diagnosticsIsError ? (
          <QueryFailureNotice error={diagnosticsError} subject="database diagnostics" />
        ) : diagnostics ? (
          <DatabaseDiagnosticsPanel diagnostics={diagnostics} />
        ) : (
          <p className="text-xs text-muted-foreground py-4">Diagnostics are not available yet.</p>
        )}
      </div>

      <div className="pt-4 border-t">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2">
              Recent runs
              <HelpTip>
                "Success" only means the job finished without erroring — it does not mean it changed anything.
                The line under each run says what it actually did, and runs that changed nothing are tagged
                "no change".
              </HelpTip>
            </h3>
            <p className="text-xs text-muted-foreground">
              Latest 25 executions of every background and admin-triggered job, newest first.
              Failures are retried up to 3 times before being logged.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["admin-job-run-logs"] });
              refetchRuns();
            }}
            disabled={runsFetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${runsFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {runsLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : runsIsError ? (
          <QueryFailureNotice error={runsError} subject="recent runs" />
        ) : !runs || runs.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">No runs recorded yet.</p>
        ) : (
          <ScrollArea className="h-[280px] rounded-md border">
            <div className="divide-y">
              {runs.map((run) => (
                <JobRunRow key={run.id} run={run} />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}

/**
 * Shown whenever the schedule couldn't be read. The switches below stay visible
 * but disabled, so the panel still documents which jobs exist without claiming
 * to know whether any of them is running.
 */
function CronFailureNotice({ failure, error }: { failure: "unavailable" | "forbidden" | "unknown"; error: unknown }) {
  if (failure === "unavailable") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-yellow-600/30 bg-yellow-500/5 p-4">
        <CalendarOff className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" aria-hidden="true" />
        <div className="text-xs">
          <p className="font-medium text-foreground">Scheduling is unavailable on this database</p>
          <p className="mt-1 text-muted-foreground">
            The pg_cron extension isn't installed, so nothing below is scheduled and none of it can be
            switched on yet. The jobs are listed so you can see what exists — their real state is
            unknown, not off. Installing pg_cron is a database change, not something this page can do.
          </p>
        </div>
      </div>
    );
  }

  if (failure === "forbidden") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="text-xs">
          <p className="font-medium text-foreground">You don't have permission to manage jobs</p>
          <p className="mt-1 text-muted-foreground">
            Scheduling is restricted to admin accounts. Everything else on this page is unaffected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="text-xs">
        <p className="font-medium text-foreground">Couldn't read the job schedule</p>
        <p className="mt-1 font-mono break-all text-muted-foreground">{cronErrorMessage(error)}</p>
      </div>
    </div>
  );
}

/**
 * Shown when Database diagnostics or Recent runs failed to load. Distinct from
 * CronFailureNotice above (different copy, no jobs list to sit above) but
 * classifies the same way — admin_database_diagnostics joins cron.job
 * unconditionally, so it fails on a missing pg_cron exactly like the job list
 * does; admin_recent_job_runs never touches cron.job, so for it "unavailable"
 * is simply a branch that can't trigger in practice.
 */
function QueryFailureNotice({ error, subject }: { error: unknown; subject: string }) {
  const failure = classifyCronError(error);

  if (failure === "unavailable") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-yellow-600/30 bg-yellow-500/5 p-4">
        <CalendarOff className="h-4 w-4 mt-0.5 shrink-0 text-yellow-600" aria-hidden="true" />
        <div className="text-xs">
          <p className="font-medium text-foreground">Couldn't read {subject} — pg_cron isn't installed</p>
          <p className="mt-1 text-muted-foreground">
            This depends on the pg_cron extension, which isn't installed on this database. It isn't
            empty — it couldn't be read.
          </p>
        </div>
      </div>
    );
  }

  if (failure === "forbidden") {
    return (
      <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
        <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
        <div className="text-xs">
          <p className="font-medium text-foreground">You don't have permission to view {subject}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
      <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
      <div className="text-xs">
        <p className="font-medium text-foreground">Couldn't read {subject}</p>
        <p className="mt-1 font-mono break-all text-muted-foreground">{cronErrorMessage(error)}</p>
      </div>
    </div>
  );
}

function DatabaseDiagnosticsPanel({ diagnostics }: { diagnostics: DatabaseDiagnostics }) {
  const activeCount = diagnostics.active_queries?.length ?? 0;
  const jobFailures = diagnostics.job_stats?.reduce((sum, job) => sum + (job.failures_last_24h ?? 0), 0) ?? 0;
  const biggestTables = (diagnostics.table_sizes ?? []).slice(0, 5);
  const topQueries = (diagnostics.top_queries ?? []).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border bg-background p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Active queries
            <HelpTip>
              Queries running at the instant you refreshed. A handful is normal; a number that stays high
              points at a slow query holding connections open.
            </HelpTip>
          </p>
          <p className="text-lg font-semibold">{activeCount}</p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Job failures, 24h
            <HelpTip>
              Scheduled jobs that errored in the last day. Anything above zero is worth opening
              Recent runs for — the error message is recorded there.
            </HelpTip>
          </p>
          <p className="text-lg font-semibold">{jobFailures}</p>
        </div>
        <div className="rounded-md border bg-background p-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            Query stats
            <HelpTip>
              Whether Postgres is recording per-query timings (the pg_stat_statements extension).
              When off, the "Top query consumers" list below stays empty.
            </HelpTip>
          </p>
          <p className="text-lg font-semibold">{diagnostics.pg_stat_statements_enabled ? "On" : "Off"}</p>
        </div>
      </div>

      <div className="rounded-md border bg-background p-3">
        <h4 className="text-xs font-semibold mb-2">Largest tables</h4>
        <div className="space-y-1">
          {biggestTables.map((table) => (
            <div key={table.relname} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate">{table.relname}</span>
              <span className="text-muted-foreground shrink-0">{table.total_size} · {table.live_rows} rows</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-md border bg-background p-3">
        <h4 className="text-xs font-semibold mb-2">Top query consumers</h4>
        {topQueries.length === 0 ? (
          <p className="text-xs text-muted-foreground">No query statistics recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {topQueries.map((query, index) => (
              <div key={`${query.calls}-${index}`} className="text-xs">
                <div className="flex gap-3 text-muted-foreground mb-1">
                  <span>{query.calls} calls</span>
                  <span>{query.total_ms}ms total</span>
                  <span>{query.mean_ms}ms avg</span>
                </div>
                <p className="font-mono break-all text-muted-foreground">{query.query}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function JobRunRow({ run }: { run: JobRunLog }) {
  const icon =
    run.status === "success" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
    ) : run.status === "partial" ? (
      <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 shrink-0" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
    );

  const when = new Date(run.created_at).toLocaleString();
  const duration = run.duration_ms != null ? `${run.duration_ms}ms` : "—";

  // "success" only means the function didn't throw. What it actually did lives
  // in metadata, so show that too — otherwise a run that queued 500 businesses
  // is indistinguishable from one that queued none.
  const { text: outcome, noChange } = summariseRun(run.job_name, run.metadata);
  const topReason = topRejectionReason(run.metadata);

  return (
    <div className="p-3 text-xs space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        {icon}
        <span className="font-medium truncate">{run.job_name}</span>
        <Badge
          variant={
            run.status === "success"
              ? "default"
              : run.status === "partial"
                ? "secondary"
                : "destructive"
          }
          className="text-[10px] px-1.5 py-0"
        >
          {run.status}
        </Badge>
        {noChange && run.status === "success" && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
            no change
          </Badge>
        )}
        <span className="ml-auto text-muted-foreground">{when}</span>
      </div>

      {outcome && (
        <p className="pl-5 font-medium text-foreground">
          {outcome}
          {topReason && <span className="font-normal text-muted-foreground"> — mostly {topReason}</span>}
        </p>
      )}

      <div className="text-muted-foreground pl-5 flex gap-3 flex-wrap">
        <span>attempts: {run.attempts}</span>
        <span>duration: {duration}</span>
      </div>
      {run.error_message && (
        <div className="pl-5 text-destructive font-mono break-all">
          {run.error_message}
        </div>
      )}
    </div>
  );
}

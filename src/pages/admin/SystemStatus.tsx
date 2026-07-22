import { useState } from "react";
import { PageMeta } from "@/components/PageMeta";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  Activity,
  HardDrive,
  Database,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";

interface SystemStatus {
  timestamp: string;
  edgeFunctions: { name: string; status: string; code: number }[];
  storage: { name: string; public: boolean; fileCount: number; totalSizeBytes: number }[];
  database: {
    posts: number;
    leads: number;
    buyers: number;
    postMetrics: number;
    postVersions: number;
  };
  cronJobs: { jobname?: string; name?: string; schedule?: string; [key: string]: unknown }[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function StatusIcon({ status }: { status: string }) {
  if (status === "healthy") return <CheckCircle2 className="h-4 w-4 text-green-500" />;
  if (status === "error") return <XCircle className="h-4 w-4 text-destructive" />;
  return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
}

export default function SystemStatusPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: status, isLoading, isError, error } = useQuery<SystemStatus>({
    queryKey: ["system-status", refreshKey],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("system-status");
      if (error) throw error;
      return data as SystemStatus;
    },
    staleTime: 30000,
  });

  return (
    <>
      <PageMeta title="System Status | Admin" description="System health overview." />
      <AdminLayout>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold font-sans">System Status</h1>
            {status?.timestamp && (
              <p className="text-xs text-muted-foreground mt-1">
                Last checked: {new Date(status.timestamp).toLocaleString()}
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => setRefreshKey((k) => k + 1)}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <Card>
            <CardContent className="py-12 text-center">
              <XCircle className="h-10 w-10 text-destructive mx-auto mb-3" />
              <p className="text-muted-foreground">Failed to load system status.</p>
              <p className="text-xs text-muted-foreground mt-1">{(error as Error)?.message}</p>
            </CardContent>
          </Card>
        ) : status ? (
          <div className="grid gap-6">
            {/* Database Stats */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Database className="h-4 w-4 text-muted-foreground" />
                  Database Records
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  {[
                    { label: "Leads", value: status.database.leads },
                    { label: "Posts", value: status.database.posts },
                    { label: "Buyers", value: status.database.buyers },
                    { label: "Page Views", value: status.database.postMetrics },
                    { label: "Post Versions", value: status.database.postVersions },
                  ].map((item) => (
                    <div key={item.label} className="text-center p-3 rounded-lg bg-muted/50">
                      <p className="text-2xl font-bold text-foreground">{item.value.toLocaleString()}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.label}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Edge Functions */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Activity className="h-4 w-4 text-muted-foreground" />
                  Backend Functions
                  <Badge variant="secondary" className="ml-auto text-xs">
                    {status.edgeFunctions.filter((f) => f.status === "healthy").length}/{status.edgeFunctions.length} healthy
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {status.edgeFunctions.map((fn) => (
                    <div
                      key={fn.name}
                      className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
                    >
                      <StatusIcon status={fn.status} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">{fn.name}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                          {fn.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Storage */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-muted-foreground" />
                  File Storage
                </CardTitle>
              </CardHeader>
              <CardContent>
                {status.storage.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No storage buckets configured.</p>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {status.storage.map((bucket) => (
                      <div key={bucket.name} className="p-4 rounded-lg border border-border bg-card">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-sm font-medium text-foreground">{bucket.name}</p>
                          <Badge variant={bucket.public ? "default" : "secondary"} className="text-[10px]">
                            {bucket.public ? "Public" : "Private"}
                          </Badge>
                        </div>
                        <div className="flex gap-6 text-xs text-muted-foreground">
                          <span>{bucket.fileCount} files</span>
                          <span>{formatBytes(bucket.totalSizeBytes)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Cron Jobs */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Scheduled Tasks
                </CardTitle>
              </CardHeader>
              <CardContent>
                {status.cronJobs.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Cron job status is managed at the infrastructure level. The publish-scheduled function runs every 5 minutes.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {status.cronJobs.map((job, i) => (
                      <div key={i} className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{job.jobname || job.name || `Job ${i + 1}`}</p>
                          <p className="text-xs text-muted-foreground">{job.schedule || "—"}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </AdminLayout>
    </>
  );
}

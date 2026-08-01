import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AdminLayout } from "@/components/admin/AdminLayout";
import { PageMeta } from "@/components/PageMeta";
import { HelpTip } from "@/components/admin/HelpTip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { Loader2, RotateCcw, Archive as ArchiveIcon, ChevronDown, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import {
  fetchArchivedSummary,
  fetchArchivedRows,
  restoreRow,
  ARCHIVABLE_TABLE_LABELS,
  type ArchivableTable,
  type ArchivedRow,
} from "@/lib/archive";

/** Columns that describe the archiving itself — shown separately, not as data. */
const ARCHIVE_COLUMNS = new Set(["archived_at", "archived_by", "archive_reason"]);

/** Renders whatever the row actually contained, without assuming a schema. */
function RowDetails({ row }: { row: ArchivedRow }) {
  const fields = useMemo(() => {
    return Object.entries(row.row_data)
      .filter(([key, value]) => {
        if (ARCHIVE_COLUMNS.has(key)) return false;
        if (value === null || value === undefined || value === "") return false;
        // Nested objects/arrays are noise in a summary view; the row is still
        // fully preserved in the database either way.
        return typeof value !== "object";
      })
      .slice(0, 24);
  }, [row.row_data]);

  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground">No further detail recorded.</p>;
  }

  return (
    <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
      {fields.map(([key, value]) => (
        <div key={key} className="flex gap-2 text-xs min-w-0">
          <dt className="text-muted-foreground shrink-0">{key.replace(/_/g, " ")}</dt>
          <dd className="font-medium truncate">{String(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function ArchivePage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ArchivableTable | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryIsError,
    error: summaryError,
  } = useQuery({
    queryKey: ["archive-summary"],
    queryFn: async () => {
      const { data, error } = await fetchArchivedSummary();
      if (error) throw new Error(error.message);
      return data;
    },
    staleTime: 15_000,
  });

  const withItems = useMemo(
    () => (summary ?? []).filter((s) => s.archived_count > 0),
    [summary],
  );

  // Default to the first table that actually has something in it, so the page
  // opens on content rather than an arbitrary empty tab.
  const activeTable = selected ?? withItems[0]?.table_name ?? null;

  const {
    data: rows,
    isLoading: rowsLoading,
    isError: rowsIsError,
    error: rowsError,
  } = useQuery({
    queryKey: ["archive-rows", activeTable],
    enabled: !!activeTable,
    queryFn: async () => {
      const { data, error } = await fetchArchivedRows(activeTable!, 100, 0);
      if (error) throw new Error(error.message);
      return data;
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ table, id }: { table: ArchivableTable; id: string }) => {
      const { error } = await restoreRow(table, id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      // Both the counts and the current list change, and other admin screens
      // now need to show the restored row again.
      qc.invalidateQueries({ queryKey: ["archive-summary"] });
      qc.invalidateQueries({ queryKey: ["archive-rows"] });
      qc.invalidateQueries();
      toast({ title: "Restored", description: "The item is live again and back in its normal list." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't restore", description: err.message, variant: "destructive" });
    },
  });

  const totalArchived = useMemo(
    () => (summary ?? []).reduce((sum, s) => sum + s.archived_count, 0),
    [summary],
  );

  return (
    <>
      <PageMeta title="Archive | Admin" description="View and restore archived items." />
      <AdminLayout>
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold font-sans">Archive</h1>
            <HelpTip>
              Removing something in the admin panel archives it rather than deleting it. Archived items
              disappear from the site and from their normal lists, but nothing is destroyed — anything
              here can be put back exactly as it was.
            </HelpTip>
            {totalArchived > 0 && <Badge variant="secondary">{totalArchived} archived</Badge>}
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Everything that has been removed. Restoring an item returns it to its normal list and, for
            listings, back onto the public site.
          </p>
        </div>

        {summaryLoading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : summaryIsError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="font-medium">Couldn't load the archive</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {(summaryError as Error)?.message}
            </p>
          </div>
        ) : withItems.length === 0 ? (
          <div className="rounded-lg border bg-card py-16 text-center">
            <ArchiveIcon className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-40" />
            <p className="text-lg font-medium">Nothing is archived</p>
            <p className="mt-1 text-sm text-muted-foreground">
              When you remove something, it will appear here instead of being deleted.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-[220px_1fr]">
            {/* Which kind of thing */}
            <nav className="space-y-1">
              {withItems.map((s) => (
                <button
                  key={s.table_name}
                  type="button"
                  onClick={() => {
                    setSelected(s.table_name);
                    setExpanded(null);
                  }}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    activeTable === s.table_name
                      ? "bg-accent font-medium text-accent-foreground"
                      : "hover:bg-accent/50"
                  }`}
                >
                  <span className="truncate">
                    {ARCHIVABLE_TABLE_LABELS[s.table_name] ?? s.table_name}
                  </span>
                  <Badge variant="outline" className="ml-2 shrink-0 text-xs">
                    {s.archived_count}
                  </Badge>
                </button>
              ))}
            </nav>

            {/* The archived rows themselves */}
            <div className="min-w-0">
              {rowsLoading ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : rowsIsError ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
                  <p className="font-medium">Couldn't load these items</p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {(rowsError as Error)?.message}
                  </p>
                </div>
              ) : !rows || rows.length === 0 ? (
                <p className="py-16 text-center text-sm text-muted-foreground">
                  Nothing archived here.
                </p>
              ) : (
                <div className="divide-y rounded-md border">
                  {rows.map((row) => {
                    const isOpen = expanded === row.id;
                    const isRestoring =
                      restoreMutation.isPending && restoreMutation.variables?.id === row.id;

                    return (
                      <div key={row.id} className="p-3">
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            onClick={() => setExpanded(isOpen ? null : row.id)}
                            className="flex min-w-0 flex-1 items-start gap-2 text-left"
                            aria-expanded={isOpen}
                          >
                            {isOpen ? (
                              <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                            )}
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{row.label}</span>
                              <span className="mt-0.5 block text-xs text-muted-foreground">
                                Archived{" "}
                                {row.archived_at
                                  ? format(new Date(row.archived_at), "d MMM yyyy, HH:mm")
                                  : "—"}
                                {row.archive_reason && ` · ${row.archive_reason}`}
                              </span>
                            </span>
                          </button>

                          <Button
                            variant="outline"
                            size="sm"
                            className="shrink-0 gap-1"
                            disabled={isRestoring}
                            onClick={() =>
                              restoreMutation.mutate({ table: activeTable!, id: row.id })
                            }
                          >
                            {isRestoring ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCcw className="h-3.5 w-3.5" />
                            )}
                            Restore
                          </Button>
                        </div>

                        {isOpen && (
                          <div className="mt-3 rounded-md bg-muted/40 p-3">
                            <RowDetails row={row} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </AdminLayout>
    </>
  );
}

import { useState, useMemo, useEffect } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowUpDown, Settings } from "lucide-react";

// Defaults to a loose row shape so call sites that don't care about the row
// type can write `ColumnDef[]` without supplying a type argument.
export interface ColumnDef<T = Record<string, unknown>> {
  key: Extract<keyof T, string>;
  label: string;
  visible: boolean; // default visibility
  render?: (value: unknown, row: T) => React.ReactNode;
}

/** Cell values come off the row as `unknown`; coerce them to something React can render. */
function renderCellValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (value instanceof Date) return value.toLocaleString();
  return String(value);
}

interface ConfigurableTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  storageKey: string;
  searchValue?: string;
}

type SortDir = "asc" | "desc";

export function ConfigurableTable<T extends Record<string, unknown>>({ columns, data, storageKey, searchValue = "" }: ConfigurableTableProps<T>) {
  const localStorageKey = `hql_cols_${storageKey}`;

  // Initialize visibility by merging stored values with column defaults
  // This ensures new columns get their default visibility and existing columns keep stored state
  const [visibility, setVisibility] = useState<Record<string, boolean>>(() => {
    const defaults = Object.fromEntries(columns.map((c) => [c.key, c.visible]));
    const stored = localStorage.getItem(localStorageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Merge: stored values override defaults for existing keys
        return { ...defaults, ...parsed };
      } catch {
        return defaults;
      }
    }
    return defaults;
  });

  // When columns change (e.g., new columns added), merge with stored visibility
  useEffect(() => {
    setVisibility((prev) => {
      const defaults = Object.fromEntries(columns.map((c) => [c.key, c.visible]));
      // Keep existing stored values, add defaults for new keys only
      const merged = { ...defaults };
      for (const key of Object.keys(prev)) {
        if (key in merged) {
          merged[key] = prev[key];
        }
      }
      return merged;
    });
  }, [columns]);

  // Persist visibility to localStorage
  useEffect(() => {
    localStorage.setItem(localStorageKey, JSON.stringify(visibility));
  }, [visibility, localStorageKey]);

  const [sortCol, setSortCol] = useState<string>(columns[0]?.key || "");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // Filter visible columns
  const visibleColumns = useMemo(
    () => columns.filter((c) => visibility[c.key] === true),
    [columns, visibility]
  );

  // Filter data by search
  const filtered = useMemo(() => {
    if (!searchValue) return data;
    const q = searchValue.toLowerCase();
    return data.filter((row: T) =>
      Object.values(row).some((v) => v != null && String(v).toLowerCase().includes(q))
    );
  }, [data, searchValue]);

  // Sort data
  const sorted = useMemo(() => {
    return [...filtered].sort((a: T, b: T) => {
      const aVal = a[sortCol];
      const bVal = b[sortCol];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp =
        typeof aVal === "number" && typeof bVal === "number"
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir]);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir("desc");
    }
  };

  // Fixed: toggle based on current actual visibility state
  const toggleColumn = (key: string) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const SortHeader = ({ col, children }: { col: string; children: React.ReactNode }) => (
    <TableHead className="cursor-pointer select-none" onClick={() => toggleSort(col)}>
      <div className="flex items-center gap-1">
        {children}
        <ArrowUpDown className="h-3 w-3 text-muted-foreground" />
      </div>
    </TableHead>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Columns ({visibleColumns.length}/{columns.length})
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[280px]">
            <div className="space-y-2">
              <p className="text-sm font-medium">Toggle Columns</p>
              <div className="max-h-[300px] overflow-y-auto space-y-2">
                {columns.map((col) => (
                  <div key={col.key} className="flex items-center space-x-2">
                    <Checkbox
                      id={`col-${col.key}`}
                      checked={visibility[col.key] === true}
                      onCheckedChange={() => toggleColumn(col.key)}
                    />
                    <label
                      htmlFor={`col-${col.key}`}
                      className="text-sm cursor-pointer flex-1 leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                    >
                      {col.label}
                    </label>
                  </div>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <span className="text-sm text-muted-foreground">{sorted.length} records</span>
      </div>

      <div className="border rounded-lg overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map((col) => (
                <SortHeader key={col.key} col={col.key}>
                  {col.label}
                </SortHeader>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row: T, i: number) => (
              <TableRow key={String(row.id || i)}>
                {visibleColumns.map((col) => {
                  const value = row[col.key];
                  return (
                    <TableCell key={col.key}>
                      {col.render ? col.render(value, row) : renderCellValue(value)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Loader2, Sparkles, FileText, Pen, AlignLeft, Search } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface AIWriterPanelProps {
  title: string;
  content: string;
  onInsert: (html: string) => void;
  onClose: () => void;
}

type Action = "generate_intro" | "generate_outline" | "rewrite" | "summarize" | "seo_suggest";

const actions: { value: Action; label: string; icon: typeof Sparkles; description: string }[] = [
  { value: "generate_intro", label: "Generate Intro", icon: FileText, description: "Write an intro based on the title" },
  { value: "generate_outline", label: "Generate Outline", icon: AlignLeft, description: "Create a structured outline" },
  { value: "rewrite", label: "Rewrite Content", icon: Pen, description: "Rewrite existing content" },
  { value: "summarize", label: "Summarize", icon: AlignLeft, description: "Summarize existing content" },
  { value: "seo_suggest", label: "SEO Suggestions", icon: Search, description: "Get title & meta description" },
];

export function AIWriterPanel({ title, content, onInsert, onClose }: AIWriterPanelProps) {
  const [action, setAction] = useState<Action>("generate_intro");
  const [tone, setTone] = useState("professional");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [seoResult, setSeoResult] = useState<{ title: string; description: string } | null>(null);

  async function runAction() {
    setLoading(true);
    setResult("");
    setSeoResult(null);

    try {
      const { data, error } = await supabase.functions.invoke("ai-writer", {
        body: {
          action,
          title,
          content,
          selectedText: content,
          tone: action === "rewrite" ? tone : undefined,
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (action === "seo_suggest" && data?.result) {
        setSeoResult(data.result);
      } else {
        setResult(data?.result || "No result generated.");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent" /> AI Writer
        </h3>
        <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">Close</Button>
      </div>

      <div className="flex gap-2 flex-wrap">
        {actions.map((a) => (
          <Button
            key={a.value}
            variant={action === a.value ? "default" : "outline"}
            size="sm"
            onClick={() => { setAction(a.value); setResult(""); setSeoResult(null); }}
            className="h-8 text-xs gap-1"
          >
            <a.icon className="h-3.5 w-3.5" />
            {a.label}
          </Button>
        ))}
      </div>

      {action === "rewrite" && (
        <Select value={tone} onValueChange={setTone}>
          <SelectTrigger className="w-48 h-8 text-xs">
            <SelectValue placeholder="Tone" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="professional">Professional</SelectItem>
            <SelectItem value="casual">Casual</SelectItem>
            <SelectItem value="formal">Formal</SelectItem>
            <SelectItem value="shorter">Shorter</SelectItem>
            <SelectItem value="longer">Longer</SelectItem>
            <SelectItem value="seo-optimized">SEO Optimized</SelectItem>
          </SelectContent>
        </Select>
      )}

      <Button onClick={runAction} disabled={loading} className="gap-2" size="sm">
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {loading ? "Generating…" : "Generate"}
      </Button>

      {result && (
        <div className="space-y-2">
          <div className="rounded-md border border-border bg-muted/30 p-3 max-h-48 overflow-y-auto text-sm prose prose-sm" dangerouslySetInnerHTML={{ __html: result }} />
          <Button size="sm" onClick={() => onInsert(result)} className="gap-1">
            Insert into post
          </Button>
        </div>
      )}

      {seoResult && (
        <div className="space-y-2 text-sm">
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div><span className="font-medium">Suggested Title:</span> {seoResult.title}</div>
            <div><span className="font-medium">Meta Description:</span> {seoResult.description}</div>
          </div>
        </div>
      )}
    </div>
  );
}

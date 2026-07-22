import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Loader2, Wand2 } from "lucide-react";

interface AIImageModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  slug: string;
  onImageGenerated: (url: string) => void;
}

export function AIImageModal({ open, onOpenChange, title, slug, onImageGenerated }: AIImageModalProps) {
  const [prompt, setPrompt] = useState("");
  const [style, setStyle] = useState("photo");
  const [loading, setLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  function handleOpen(isOpen: boolean) {
    if (isOpen && !prompt && title) {
      setPrompt(`Professional image for: ${title}`);
    }
    if (!isOpen) {
      setPreviewUrl(null);
    }
    onOpenChange(isOpen);
  }

  async function generate() {
    if (!prompt.trim()) {
      toast({ title: "Please enter a prompt", variant: "destructive" });
      return;
    }

    setLoading(true);
    setPreviewUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke("ai-image", {
        body: { prompt, style, slug },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      if (data?.url) {
        setPreviewUrl(data.url);
        toast({ title: "Image generated successfully!" });
      } else {
        throw new Error("No image URL returned");
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Failed to generate image", description: msg, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  function useImage() {
    if (previewUrl) {
      onImageGenerated(previewUrl);
      setPreviewUrl(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wand2 className="h-5 w-5" /> Generate Featured Image
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs text-muted-foreground">Prompt</Label>
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the image you want…"
            />
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Style</Label>
            <Select value={style} onValueChange={setStyle}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="photo">Photorealistic</SelectItem>
                <SelectItem value="illustration">Illustration</SelectItem>
                <SelectItem value="flat">Flat Design</SelectItem>
                <SelectItem value="3d">3D Rendered</SelectItem>
                <SelectItem value="cinematic">Cinematic</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={generate} disabled={loading} className="w-full gap-2">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
            {loading ? "Generating…" : "Generate Image"}
          </Button>

          {previewUrl && (
            <div className="space-y-2">
              <img src={previewUrl} alt="Generated" className="w-full rounded-md border border-border" />
              <Button onClick={useImage} className="w-full">Use This Image</Button>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

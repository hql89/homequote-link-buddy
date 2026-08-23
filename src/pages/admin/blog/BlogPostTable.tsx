import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";

interface Post {
  id: string;
  title: string;
  slug: string;
  status: string;
  source: string;
  tags: string[] | null;
  created_at: string | null;
  published_at: string | null;
}

interface BlogPostTableProps {
  posts: Post[];
  onEdit: (post: Post) => void;
  onDelete: (id: string) => void;
}

export function BlogPostTable({ posts, onEdit, onDelete }: BlogPostTableProps) {
  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead className="hidden sm:table-cell">Status</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead className="hidden md:table-cell">Tags</TableHead>
            <TableHead className="hidden md:table-cell">Date</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {posts.map((post) => (
            <TableRow key={post.id}>
              <TableCell>
                <div className="font-medium truncate max-w-[260px]">{post.title}</div>
                <div className="text-xs text-muted-foreground mt-0.5">/{post.slug}</div>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <Badge variant={post.status === "published" ? "default" : post.status === "scheduled" ? "outline" : "secondary"}>
                  {post.status}
                </Badge>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {post.source === "contentflow" ? "ContentFlow" : "Native"}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex gap-1 flex-wrap max-w-[150px]">
                  {post.tags?.slice(0, 2).map(t => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                  {(post.tags?.length || 0) > 2 && <span className="text-xs text-muted-foreground">+{post.tags!.length - 2}</span>}
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                {post.status === "published" && post.published_at
                  ? format(new Date(post.published_at), "MMM d, yyyy")
                  : post.created_at
                    ? format(new Date(post.created_at), "MMM d, yyyy")
                    : "—"}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="icon" asChild>
                    <a href={`/blog/${post.slug}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(post)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => onDelete(post.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

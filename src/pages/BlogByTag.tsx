import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ArrowLeft } from "lucide-react";
import { format } from "date-fns";

interface Post {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  content: string;
  featured_image_url: string | null;
  published_at: string;
  tags: string[] | null;
  category: string | null;
}

const PAGE_SIZE = 8;

function estimateReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, "");
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
}

export default function BlogByTag() {
  const { tag } = useParams<{ tag: string }>();
  const decodedTag = decodeURIComponent(tag || "");
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadPosts = useCallback(async (offset = 0, append = false) => {
    if (append) setLoadingMore(true); else setLoading(true);

    const { data } = await supabase
      .from("posts")
      .select("id, title, slug, excerpt, content, featured_image_url, published_at, tags, category")
      .eq("status", "published")
      .contains("tags", [decodedTag])
      .order("published_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);

    const fetched = (data as Post[]) ?? [];
    if (append) {
      setPosts(prev => [...prev, ...fetched]);
    } else {
      setPosts(fetched);
    }
    setHasMore(fetched.length === PAGE_SIZE);
    setLoading(false);
    setLoadingMore(false);
  }, [decodedTag]);

  useEffect(() => { loadPosts(); }, [loadPosts]);

  return (
    <>
      <PageMeta
        title={`Posts tagged "${decodedTag}" | Valley Home Pros Blog`}
        description={`Browse all articles tagged with "${decodedTag}" on the Valley Home Pros blog.`}
      />
      <Header />
      <main className="min-h-screen bg-background">
        <section className="py-16 md:py-24">
          <div className="container max-w-5xl mx-auto px-4">
            <Link to="/blog" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
              <ArrowLeft className="h-4 w-4" /> Back to Blog
            </Link>
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 font-serif">
              Tag: <span className="text-primary">{decodedTag}</span>
            </h1>
            <p className="text-lg text-muted-foreground mb-12">
              All articles tagged with "{decodedTag}".
            </p>

            {loading ? (
              <div className="grid gap-8 md:grid-cols-2">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="rounded-xl border border-border bg-card animate-pulse h-80" />
                ))}
              </div>
            ) : posts.length === 0 ? (
              <p className="text-muted-foreground text-center py-20">No articles found with this tag.</p>
            ) : (
              <>
                <div className="grid gap-8 md:grid-cols-2">
                  {posts.map(post => (
                    <Link key={post.id} to={`/blog/${post.slug}`} className="group rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                      {post.featured_image_url && (
                        <div className="aspect-video overflow-hidden">
                          <img src={post.featured_image_url} alt={post.title} width={768} height={432} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" loading="lazy" decoding="async" />
                        </div>
                      )}
                      <div className="p-6">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                          <time className="font-medium uppercase tracking-wider">{format(new Date(post.published_at), "MMMM d, yyyy")}</time>
                          <span>·</span>
                          <span>{estimateReadingTime(post.content)} min read</span>
                        </div>
                        <h2 className="text-xl font-semibold text-card-foreground mt-1 mb-3 group-hover:text-primary transition-colors">{post.title}</h2>
                        {post.excerpt && <p className="text-muted-foreground text-sm line-clamp-3">{post.excerpt}</p>}
                        {post.tags && post.tags.length > 0 && (
                          <div className="flex gap-1.5 mt-3 flex-wrap">
                            {post.tags.slice(0, 3).map(t => (
                              <Badge key={t} variant={t === decodedTag ? "default" : "secondary"} className="text-xs">{t}</Badge>
                            ))}
                          </div>
                        )}
                        <span className="inline-block mt-4 text-sm font-medium text-primary group-hover:underline">Read more →</span>
                      </div>
                    </Link>
                  ))}
                </div>
                {hasMore && (
                  <div className="flex justify-center mt-12">
                    <Button variant="outline" size="lg" onClick={() => loadPosts(posts.length, true)} disabled={loadingMore} className="gap-2">
                      {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />} Load More
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

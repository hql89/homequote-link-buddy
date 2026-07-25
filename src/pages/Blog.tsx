import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FolderOpen, Tags } from "lucide-react";
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

export default function Blog() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);

  async function loadPosts(offset = 0, append = false) {
    if (append) setLoadingMore(true); else setLoading(true);

    const { data } = await supabase
      .from("posts")
      .select("id, title, slug, excerpt, content, featured_image_url, published_at, tags, category")
      .eq("status", "published")
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
  }

  // Load all categories and tags once
  useEffect(() => {
    loadPosts();

    supabase
      .from("posts")
      .select("tags, category")
      .eq("status", "published")
      .then(({ data }) => {
        if (!data) return;
        const cats = new Set<string>();
        const tags = new Set<string>();
        for (const p of data) {
          if (p.category) cats.add(p.category);
          if (p.tags && Array.isArray(p.tags)) {
            for (const t of p.tags) tags.add(t);
          }
        }
        setAllCategories(Array.from(cats).sort());
        setAllTags(Array.from(tags).sort());
      });
  }, []);

  const hasSidebarContent = allCategories.length > 0 || allTags.length > 0;

  return (
    <>
      <PageMeta
        title="Home Service Blog — Tips & Guides | Valley Home Pros"
        description="Expert plumbing tips, home maintenance guides, and industry insights for Santa Clarita Valley homeowners."
        canonicalPath="/blog"
      />
      <Header />
      <main className="min-h-screen bg-background">
        <section className="py-16 md:py-24">
          <div className="container max-w-6xl mx-auto px-4">
            <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4 font-serif">Blog</h1>
            <p className="text-lg text-muted-foreground mb-12 max-w-2xl">
              Expert plumbing tips, home maintenance guides, and industry insights.
            </p>

            <div className={`flex flex-col ${hasSidebarContent ? "lg:flex-row lg:gap-12" : ""}`}>
              {/* Main content */}
              <div className="flex-1 min-w-0">
                {loading ? (
                  <div className="grid gap-8 md:grid-cols-2">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="rounded-xl border border-border bg-card animate-pulse h-80" />
                    ))}
                  </div>
                ) : posts.length === 0 ? (
                  <p className="text-muted-foreground text-center py-20">
                    No articles published yet. Check back soon!
                  </p>
                ) : (
                  <>
                    <div className="grid gap-8 md:grid-cols-2">
                      {posts.map((post) => (
                        <Link
                          key={post.id}
                          to={`/blog/${post.slug}`}
                          className="group rounded-xl border border-border bg-card overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                        >
                          {post.featured_image_url && (
                            <div className="aspect-video overflow-hidden">
                              <img
                                src={post.featured_image_url}
                                alt={post.title}
                                width={768}
                                height={432}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                loading="lazy"
                                decoding="async"
                              />
                            </div>
                          )}
                          <div className="p-6">
                            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                              <time className="font-medium uppercase tracking-wider">
                                {format(new Date(post.published_at), "MMMM d, yyyy")}
                              </time>
                              <span>·</span>
                              <span>{estimateReadingTime(post.content)} min read</span>
                            </div>
                            <h2 className="text-xl font-semibold text-card-foreground mt-1 mb-3 group-hover:text-primary transition-colors">
                              {post.title}
                            </h2>
                            {post.excerpt && (
                              <p className="text-muted-foreground text-sm line-clamp-3">{post.excerpt}</p>
                            )}
                            {post.tags && post.tags.length > 0 && (
                              <div className="flex gap-1.5 mt-3 flex-wrap" onClick={e => e.preventDefault()}>
                                {post.tags.slice(0, 3).map(tag => (
                                  <Link key={tag} to={`/blog/tag/${encodeURIComponent(tag)}`}>
                                    <Badge variant="secondary" className="text-xs hover:bg-secondary/60">{tag}</Badge>
                                  </Link>
                                ))}
                              </div>
                            )}
                            <span className="inline-block mt-4 text-sm font-medium text-primary group-hover:underline">
                              Read more →
                            </span>
                          </div>
                        </Link>
                      ))}
                    </div>

                    {hasMore && (
                      <div className="flex justify-center mt-12">
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={() => loadPosts(posts.length, true)}
                          disabled={loadingMore}
                          className="gap-2"
                        >
                          {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                          Load More
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Sidebar */}
              {hasSidebarContent && (
                <aside className="w-full lg:w-64 flex-shrink-0 mt-12 lg:mt-0">
                  <div className="lg:sticky lg:top-24 space-y-8">
                    {allCategories.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                          <FolderOpen className="h-4 w-4 text-muted-foreground" />
                          Categories
                        </h3>
                        <ul className="space-y-1">
                          {allCategories.map(cat => (
                            <li key={cat}>
                              <Link
                                to={`/blog/category/${encodeURIComponent(cat)}`}
                                className="block text-sm text-muted-foreground hover:text-primary transition-colors py-1.5 px-2 rounded-md hover:bg-muted/50"
                              >
                                {cat}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {allTags.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
                          <Tags className="h-4 w-4 text-muted-foreground" />
                          Tags
                        </h3>
                        <div className="flex flex-wrap gap-1.5">
                          {allTags.map(tag => (
                            <Link key={tag} to={`/blog/tag/${encodeURIComponent(tag)}`}>
                              <Badge variant="secondary" className="text-xs hover:bg-secondary/60 cursor-pointer">
                                {tag}
                              </Badge>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </aside>
              )}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

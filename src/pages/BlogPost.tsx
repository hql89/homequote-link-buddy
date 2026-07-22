import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import DOMPurify from "dompurify";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { BreadcrumbNav } from "@/components/public/BreadcrumbNav";

interface Post {
  id: string;
  title: string;
  slug: string;
  content: string;
  excerpt: string | null;
  featured_image_url: string | null;
  published_at: string;
  tags: string[] | null;
  category: string | null;
  meta_title?: string | null;
  meta_description?: string | null;
  og_image_width?: number | null;
  og_image_height?: number | null;
  twitter_card_type?: string | null;
  canonical_url?: string | null;
}

interface NavPost {
  title: string;
  slug: string;
}

function estimateReadingTime(html: string): number {
  const text = html.replace(/<[^>]*>/g, "");
  return Math.max(1, Math.ceil(text.split(/\s+/).filter(Boolean).length / 200));
}

export default function BlogPost() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [loading, setLoading] = useState(true);
  const [prevPost, setPrevPost] = useState<NavPost | null>(null);
  const [nextPost, setNextPost] = useState<NavPost | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    setPrevPost(null);
    setNextPost(null);

    supabase
      .from("posts")
      .select("*")
      .eq("slug", slug)
      .eq("status", "published")
      .single()
      .then(({ data }) => {
        const p = data as Post | null;
        setPost(p);
        setLoading(false);

        if (p?.published_at) {
          // Fetch prev (older) post
          supabase
            .from("posts")
            .select("title, slug")
            .eq("status", "published")
            .lt("published_at", p.published_at)
            .order("published_at", { ascending: false })
            .limit(1)
            .single()
            .then(({ data: prev }) => setPrevPost(prev as NavPost | null));

          // Fetch next (newer) post
          supabase
            .from("posts")
            .select("title, slug")
            .eq("status", "published")
            .gt("published_at", p.published_at)
            .order("published_at", { ascending: true })
            .limit(1)
            .single()
            .then(({ data: next }) => setNextPost(next as NavPost | null));
        }
      });
  }, [slug]);

  // Track view
  useEffect(() => {
    if (!post) return;
    let sessionId = sessionStorage.getItem("hql_session");
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem("hql_session", sessionId);
    }
    supabase.functions.invoke("track-view", {
      body: { post_id: post.id, session_id: sessionId, referrer: document.referrer || null },
    }).catch(() => {});
  }, [post]);

  // SEO meta tags
  useEffect(() => {
    if (!post) return;
    const seoTitle = post.meta_title || post.title;
    document.title = `${seoTitle} | HomeQuoteLink Blog`;

    const setMeta = (name: string, content: string, property = false) => {
      const attr = property ? "property" : "name";
      let el = document.querySelector(`meta[${attr}="${name}"]`);
      if (!el) { el = document.createElement("meta"); el.setAttribute(attr, name); document.head.appendChild(el); }
      el.setAttribute("content", content);
    };

    const seoDesc = post.meta_description || post.excerpt;
    if (seoDesc) setMeta("description", seoDesc);
    setMeta("og:title", seoTitle, true);
    if (seoDesc) setMeta("og:description", seoDesc, true);
    setMeta("og:type", "article", true);
    if (post.featured_image_url) {
      setMeta("og:image", post.featured_image_url, true);
      const ogW = post.og_image_width;
      const ogH = post.og_image_height;
      if (ogW) setMeta("og:image:width", String(ogW), true);
      if (ogH) setMeta("og:image:height", String(ogH), true);
    }
    const twitterCard = post.twitter_card_type || "summary_large_image";
    setMeta("twitter:card", twitterCard, true);
    setMeta("twitter:title", seoTitle, true);
    if (seoDesc) setMeta("twitter:description", seoDesc, true);

    let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) { canonical = document.createElement("link"); canonical.rel = "canonical"; document.head.appendChild(canonical); }
    canonical.href = post.canonical_url || `${window.location.origin}/blog/${post.slug}`;

    const siteUrl = window.location.origin;
    const breadcrumbSchema = {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: siteUrl },
        { "@type": "ListItem", position: 2, name: "Blog", item: `${siteUrl}/blog` },
        ...(post.category ? [{ "@type": "ListItem", position: 3, name: post.category, item: `${siteUrl}/blog/category/${encodeURIComponent(post.category)}` }] : []),
        { "@type": "ListItem", position: post.category ? 4 : 3, name: post.title },
      ],
    };

    const articleScript = document.createElement("script");
    articleScript.type = "application/ld+json";
    articleScript.setAttribute("data-jsonld", "article");
    articleScript.textContent = JSON.stringify({
      "@context": "https://schema.org", "@type": "Article",
      headline: post.title, description: post.excerpt || "",
      image: post.featured_image_url || undefined,
      datePublished: post.published_at,
      author: { "@type": "Organization", name: "HomeQuoteLink" },
      publisher: { "@type": "Organization", name: "HomeQuoteLink" },
      url: `${siteUrl}/blog/${post.slug}`,
    });
    document.head.appendChild(articleScript);

    const breadcrumbScript = document.createElement("script");
    breadcrumbScript.type = "application/ld+json";
    breadcrumbScript.setAttribute("data-jsonld", "breadcrumb-blog");
    breadcrumbScript.textContent = JSON.stringify(breadcrumbSchema);
    document.head.appendChild(breadcrumbScript);

    return () => {
      articleScript.remove();
      breadcrumbScript.remove();
    };
  }, [post]);

  if (loading) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-background">
          <div className="container max-w-3xl mx-auto px-4 py-20">
            <div className="animate-pulse space-y-4">
              <div className="h-8 bg-muted rounded w-3/4" />
              <div className="h-4 bg-muted rounded w-1/4" />
              <div className="h-64 bg-muted rounded mt-8" />
            </div>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (!post) {
    return (
      <>
        <Header />
        <main className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-foreground mb-4">Article Not Found</h1>
            <p className="text-muted-foreground mb-6">The article you're looking for doesn't exist or has been removed.</p>
            <Link to="/blog" className="text-primary hover:underline font-medium">← Back to Blog</Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const sanitizedContent = DOMPurify.sanitize(post.content, {
    ADD_TAGS: ["iframe"],
    ADD_ATTR: ["allow", "allowfullscreen", "frameborder", "scrolling"],
  });
  const readingTime = estimateReadingTime(post.content);

  return (
    <>
      <Header />
      <main className="min-h-screen bg-background">
        <article className="py-12 md:py-20">
          <div className="container max-w-3xl mx-auto px-4">
            <div className="mb-8">
              <BreadcrumbNav
                items={[
                  { label: "Blog", to: "/blog" },
                  ...(post.category ? [{ label: post.category, to: `/blog/category/${encodeURIComponent(post.category)}` }] : []),
                  { label: post.title },
                ]}
              />
            </div>

            <header className="mb-10">
              <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
                <time className="font-medium uppercase tracking-wider">
                  {format(new Date(post.published_at), "MMMM d, yyyy")}
                </time>
                <span>·</span>
                <span>{readingTime} min read</span>
                {post.category && (
                  <>
                    <span>·</span>
                    <Link to={`/blog/category/${encodeURIComponent(post.category)}`} className="hover:text-primary transition-colors">
                      {post.category}
                    </Link>
                  </>
                )}
              </div>
              <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground font-serif leading-tight">
                {post.title}
              </h1>
              {post.excerpt && (
                <p className="text-lg text-muted-foreground mt-4 leading-relaxed">{post.excerpt}</p>
              )}
              {post.tags && post.tags.length > 0 && (
                <div className="flex gap-2 mt-4 flex-wrap">
                  {post.tags.map(tag => (
                    <Link key={tag} to={`/blog/tag/${encodeURIComponent(tag)}`}>
                      <Badge variant="secondary" className="hover:bg-secondary/60">{tag}</Badge>
                    </Link>
                  ))}
                </div>
              )}
            </header>

            {post.featured_image_url && (
              <div className="rounded-xl overflow-hidden mb-10">
                <img src={post.featured_image_url} alt={post.title} width={1200} height={675} className="w-full h-auto" loading="lazy" decoding="async" />
              </div>
            )}

            <div
              className="prose prose-lg max-w-none
                prose-headings:text-foreground prose-headings:font-serif
                prose-p:text-foreground/85 prose-p:leading-relaxed
                prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                prose-strong:text-foreground
                prose-img:rounded-lg
                prose-blockquote:border-primary prose-blockquote:text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: sanitizedContent }}
            />

            {/* Prev / Next navigation */}
            {(prevPost || nextPost) && (
              <nav className="mt-16 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
                {prevPost ? (
                  <Link
                    to={`/blog/${prevPost.slug}`}
                    className="group flex items-start gap-3 p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5 mt-0.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Previous</span>
                      <p className="text-sm font-medium text-foreground group-hover:text-primary mt-1 line-clamp-2">
                        {prevPost.title}
                      </p>
                    </div>
                  </Link>
                ) : <div />}
                {nextPost ? (
                  <Link
                    to={`/blog/${nextPost.slug}`}
                    className="group flex items-start gap-3 p-4 rounded-lg border border-border hover:bg-muted/50 transition-colors text-right sm:justify-end"
                  >
                    <div>
                      <span className="text-xs text-muted-foreground uppercase tracking-wider">Next</span>
                      <p className="text-sm font-medium text-foreground group-hover:text-primary mt-1 line-clamp-2">
                        {nextPost.title}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 mt-0.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
                  </Link>
                ) : <div />}
              </nav>
            )}
          </div>
        </article>
      </main>
      <Footer />
    </>
  );
}

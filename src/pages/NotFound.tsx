import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.warn("404: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <>
      <PageMeta
        title="Page Not Found | Valley Home Pros"
        description="The page you're looking for doesn't exist."
        noIndex
      />
      <Header />
      <main id="main-content" className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center px-4">
          <h1 className="mb-4 text-5xl font-bold text-foreground">404</h1>
          <p className="mb-6 text-xl text-muted-foreground">
            Oops! The page you're looking for doesn't exist.
          </p>
          <Link
            to="/"
            className="inline-flex items-center rounded-md bg-primary px-6 py-3 font-semibold text-primary-foreground transition hover:bg-primary/90"
          >
            Return to Home
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
};

export default NotFound;

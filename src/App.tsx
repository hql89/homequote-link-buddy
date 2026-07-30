import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ProtectedRoute } from "@/components/admin/ProtectedRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageTracker } from "@/components/PageTracker";
import { Loader2 } from "lucide-react";

// --- Public pages ---
const Index = lazy(() => import("./pages/Index"));
const ThankYou = lazy(() => import("./pages/ThankYou"));
const PrivacyPolicy = lazy(() => import("./pages/PrivacyPolicy"));
const TermsOfService = lazy(() => import("./pages/TermsOfService"));
const FAQ = lazy(() => import("./pages/FAQ"));
const Blog = lazy(() => import("./pages/Blog"));
const BlogPost = lazy(() => import("./pages/BlogPost"));
const BlogByTag = lazy(() => import("./pages/BlogByTag"));
const BlogByCategory = lazy(() => import("./pages/BlogByCategory"));
const Feedback = lazy(() => import("./pages/Feedback"));
const Providers = lazy(() => import("./pages/Providers"));
const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
const NotFound = lazy(() => import("./pages/NotFound"));

// --- Directory engine ---
const DirectoryIndex = lazy(() => import("./pages/DirectoryIndex"));
const DirectoryCity = lazy(() => import("./pages/DirectoryCity"));
const DirectoryListing = lazy(() => import("./pages/DirectoryListing"));
const ClaimListing = lazy(() => import("./pages/ClaimListing"));

// --- Service pages ---
const EmergencyTreeRemoval = lazy(() => import("./pages/services/EmergencyTreeRemoval"));
const BrushClearing = lazy(() => import("./pages/services/BrushClearing"));
const PalmTreeTrimming = lazy(() => import("./pages/services/PalmTreeTrimming"));

// --- Auth pages ---
const Login = lazy(() => import("./pages/Login"));
const Account = lazy(() => import("./pages/Account"));
const ProviderLogin = lazy(() => import("./pages/ProviderLogin"));
const ProviderDashboard = lazy(() => import("./pages/ProviderDashboard"));
const AdminLogin = lazy(() => import("./pages/admin/Login"));
const ResetPassword = lazy(() => import("./pages/admin/ResetPassword"));

// --- Admin pages ---
const IngestPage = lazy(() => import("./pages/admin/Ingest"));
const PhotoModerationPage = lazy(() => import("./pages/admin/PhotoModeration"));
const RepliesPage = lazy(() => import("./pages/admin/Replies"));
const EnrichmentPage = lazy(() => import("./pages/admin/Enrichment"));
const AdminDashboard = lazy(() => import("./pages/admin/Dashboard"));
const LeadDetail = lazy(() => import("./pages/admin/LeadDetail"));
const BuyersPage = lazy(() => import("./pages/admin/Buyers"));
const RoutingPage = lazy(() => import("./pages/admin/Routing"));
const SettingsPage = lazy(() => import("./pages/admin/Settings"));
const BlogPostsPage = lazy(() => import("./pages/admin/BlogPosts"));
const MediaLibraryPage = lazy(() => import("./pages/admin/MediaLibrary"));
const SystemStatusPage = lazy(() => import("./pages/admin/SystemStatus"));
const SiteAnalyticsPage = lazy(() => import("./pages/admin/SiteAnalytics"));
const AnalyticsDetailPage = lazy(() => import("./pages/admin/AnalyticsDetail"));
const HomeownersPage = lazy(() => import("./pages/admin/Homeowners"));
const ReviewsPage = lazy(() => import("./pages/admin/Reviews"));
const BuyerProfilesPage = lazy(() => import("./pages/admin/BuyerProfiles"));
const VerticalsPage = lazy(() => import("./pages/admin/Verticals"));
const ProviderApplicationsPage = lazy(() => import("./pages/admin/ProviderApplications"));
const SpamMonitorPage = lazy(() => import("./pages/admin/SpamMonitor"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
    },
  },
});

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:rounded-md focus:bg-accent focus:px-4 focus:py-2 focus:text-accent-foreground focus:font-semibold focus:shadow-lg"
        >
          Skip to main content
        </a>
        <PageTracker />
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/thank-you" element={<ThankYou />} />
              <Route path="/services/emergency-tree-removal" element={<EmergencyTreeRemoval />} />
              <Route path="/services/brush-clearing" element={<BrushClearing />} />
              <Route path="/services/palm-tree-trimming" element={<PalmTreeTrimming />} />
              <Route path="/privacy" element={<PrivacyPolicy />} />
              <Route path="/terms" element={<TermsOfService />} />
              <Route path="/faq" element={<FAQ />} />
              <Route path="/blog" element={<Blog />} />
              <Route path="/blog/tag/:tag" element={<BlogByTag />} />
              <Route path="/blog/category/:category" element={<BlogByCategory />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
              <Route path="/feedback" element={<Feedback />} />
              <Route path="/login" element={<Login />} />
              <Route path="/account" element={<Account />} />
              <Route path="/provider/login" element={<ProviderLogin />} />
              <Route path="/provider/dashboard" element={<ProviderDashboard />} />
              <Route path="/providers" element={<Providers />} />
              <Route path="/providers/:id" element={<ProviderDetail />} />
              <Route path="/directory" element={<DirectoryIndex />} />
              <Route path="/directory/:city" element={<DirectoryCity />} />
              <Route path="/directory/:city/:slug/claim" element={<ClaimListing />} />
              <Route path="/directory/:city/:slug" element={<DirectoryListing />} />
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
              <Route path="/admin/leads/:id" element={<ProtectedRoute><LeadDetail /></ProtectedRoute>} />
              <Route path="/admin/buyers" element={<ProtectedRoute><BuyersPage /></ProtectedRoute>} />
              <Route path="/admin/routing" element={<ProtectedRoute><RoutingPage /></ProtectedRoute>} />
              <Route path="/admin/blog" element={<ProtectedRoute><BlogPostsPage /></ProtectedRoute>} />
              <Route path="/admin/media" element={<ProtectedRoute><MediaLibraryPage /></ProtectedRoute>} />
              <Route path="/admin/analytics" element={<ProtectedRoute><SiteAnalyticsPage /></ProtectedRoute>} />
              <Route path="/admin/analytics/:metric" element={<ProtectedRoute><AnalyticsDetailPage /></ProtectedRoute>} />
              <Route path="/admin/site-analytics" element={<Navigate to="/admin/analytics" replace />} />
              <Route path="/admin/system" element={<ProtectedRoute><SystemStatusPage /></ProtectedRoute>} />
              <Route path="/admin/homeowners" element={<ProtectedRoute><HomeownersPage /></ProtectedRoute>} />
              <Route path="/admin/reviews" element={<ProtectedRoute><ReviewsPage /></ProtectedRoute>} />
              <Route path="/admin/buyer-profiles" element={<ProtectedRoute><BuyerProfilesPage /></ProtectedRoute>} />
              <Route path="/admin/applications" element={<ProtectedRoute><ProviderApplicationsPage /></ProtectedRoute>} />
              <Route path="/admin/ingest" element={<ProtectedRoute><IngestPage /></ProtectedRoute>} />
              <Route path="/admin/photos" element={<ProtectedRoute><PhotoModerationPage /></ProtectedRoute>} />
              <Route path="/admin/replies" element={<ProtectedRoute><RepliesPage /></ProtectedRoute>} />
              <Route path="/admin/enrichment" element={<ProtectedRoute><EnrichmentPage /></ProtectedRoute>} />
              <Route path="/admin/verticals" element={<ProtectedRoute><VerticalsPage /></ProtectedRoute>} />
              <Route path="/admin/settings" element={<ProtectedRoute><SettingsPage /></ProtectedRoute>} />
              <Route path="/admin/spam" element={<ProtectedRoute><SpamMonitorPage /></ProtectedRoute>} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;

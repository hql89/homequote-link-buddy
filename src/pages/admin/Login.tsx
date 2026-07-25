import { SITE_NAME } from "@/lib/constants";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Wrench, Loader2 } from "lucide-react";

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSignUp, setIsSignUp] = useState(false);
  const [isForgot, setIsForgot] = useState(false);
  const { signIn, signUp } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (isForgot) {
        const { error } = await (await import("@/integrations/supabase/client")).supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw error;
        toast({ title: "Reset link sent", description: "Check your email for a password reset link." });
        setIsForgot(false);
      } else if (isSignUp) {
        await signUp(email, password);
        toast({ title: "Account created", description: "Check your email to confirm, then sign in." });
        setIsSignUp(false);
      } else {
        await signIn(email, password);
        navigate("/admin");
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        toast({ title: isForgot ? "Reset failed" : isSignUp ? "Sign-up failed" : "Login failed", description: error.message, variant: "destructive" });
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageMeta title="Admin Login | Valley Home Pros" description="Admin login for Valley Home Pros CRM." noIndex />
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-center gap-2">
            <Wrench className="h-6 w-6 text-accent" />
            <span className="text-xl font-bold text-primary font-serif">{SITE_NAME}</span>
          </div>
          <h1 className="mb-6 text-center text-2xl font-bold font-sans">{isForgot ? "Reset Password" : isSignUp ? "Create Account" : "Admin Login"}</h1>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            {!isForgot && (
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
            )}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {isForgot ? "Sending…" : isSignUp ? "Creating…" : "Signing in…"}</> : isForgot ? "Send Reset Link" : isSignUp ? "Create Account" : "Sign In"}
            </Button>
            {!isSignUp && !isForgot && (
              <p className="text-center text-sm">
                <button type="button" className="underline text-primary" onClick={() => setIsForgot(true)}>Forgot password?</button>
              </p>
            )}
            <p className="text-center text-sm text-muted-foreground">
              {isForgot ? (
                <button type="button" className="underline text-primary" onClick={() => setIsForgot(false)}>Back to sign in</button>
              ) : (
                <>
                  {isSignUp ? "Already have an account?" : "Need an account?"}{" "}
                  <button type="button" className="underline text-primary" onClick={() => setIsSignUp(!isSignUp)}>
                    {isSignUp ? "Sign in" : "Sign up"}
                  </button>
                </>
              )}
            </p>
          </form>
        </div>
      </div>
    </>
  );
}

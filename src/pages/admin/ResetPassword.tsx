import { SITE_NAME } from "@/lib/constants";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageMeta } from "@/components/PageMeta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Wrench, Loader2 } from "lucide-react";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for the PASSWORD_RECOVERY event which fires when user clicks the reset link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setReady(true);
      }
    });

    // Also check if we already have a session (user may have already been logged in via the recovery link)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      navigate("/admin");
    } catch (error: unknown) {
      toast({ title: "Failed to update password", description: (error as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageMeta title="Reset Password | Valley Home Pros" description="Set a new password for your admin account." />
      <div className="flex min-h-screen items-center justify-center bg-muted p-4">
        <div className="w-full max-w-sm rounded-xl border bg-card p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-center gap-2">
            <Wrench className="h-6 w-6 text-accent" />
            <span className="text-xl font-bold text-primary font-serif">{SITE_NAME}</span>
          </div>
          <h1 className="mb-6 text-center text-2xl font-bold font-sans">Set New Password</h1>
          {!ready ? (
            <p className="text-center text-muted-foreground text-sm">
              Loading your session… If this persists, try clicking the reset link from your email again.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="password">New Password</Label>
                <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Updating…</> : "Update Password"}
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

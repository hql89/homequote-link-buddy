import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Header } from "@/components/public/Header";
import { Footer } from "@/components/public/Footer";
import { PageMeta } from "@/components/PageMeta";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

export default function ProviderLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
    } else {
      navigate("/provider/dashboard");
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      toast({ title: "Signup failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }

    // Create buyer_profile — link to existing buyer if email matches, otherwise leave unlinked (becomes an application)
    if (data.user) {
      const { data: buyer } = await supabase
        .from("buyers")
        .select("id")
        .eq("email", email.toLowerCase().trim())
        .maybeSingle();

      await supabase.from("buyer_profiles").insert({
        buyer_id: buyer?.id ?? null,
        user_id: data.user.id,
        company_description: null,
        website: null,
      });
    }

    setLoading(false);
    toast({
      title: "Check your email",
      description: "We sent a confirmation link. Verify your email to continue.",
    });
  };

  return (
    <>
      <PageMeta title="Provider Login | Sherman Oaks Home Pros" description="Log in to manage your leads and access ServiceStack OS." />
      <Header />
      <main className="container flex justify-center py-16">
        <div className="w-full max-w-4xl grid md:grid-cols-2 gap-8 items-start">
          
          <div className="space-y-6 pt-4">
            <h1 className="text-4xl font-black text-primary leading-tight">Stop Losing $3,000 Jobs to Missed Calls.</h1>
            <p className="text-lg text-muted-foreground">
              When a homeowner has an emergency and you don't answer, they call the next guy on Google.
            </p>
            <ul className="space-y-4">
              <li className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                <p><strong>Instant Missed-Call Text-Back:</strong> The second you miss a call, our system texts the client to lock them in.</p>
              </li>
              <li className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                <p><strong>Automated Review Funnel:</strong> Automatically request 5-star reviews after every job.</p>
              </li>
              <li className="flex gap-3">
                <div className="mt-1 h-2 w-2 rounded-full bg-accent flex-shrink-0" />
                <p><strong>20% Revenue Share Leads:</strong> We send you pre-qualified Sherman Oaks tree service leads. You only pay when you close.</p>
              </li>
            </ul>
          </div>

          <Card className="w-full shadow-lg border-2 border-primary/20">
            <CardHeader className="text-center bg-primary/5 pb-6">
              <CardTitle className="text-2xl font-serif text-primary">ServiceStack OS Portal</CardTitle>
              <CardDescription>Log in or claim your free directory listing.</CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
            <Tabs defaultValue="login">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="login">Log In</TabsTrigger>
                <TabsTrigger value="signup">Sign Up</TabsTrigger>
              </TabsList>
              <TabsContent value="login">
                <form onSubmit={handleLogin} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="p-login-email">Email</Label>
                    <Input id="p-login-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-login-password">Password</Label>
                    <Input id="p-login-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Log In
                  </Button>
                </form>
              </TabsContent>
              <TabsContent value="signup">
                <form onSubmit={handleSignup} className="space-y-4 pt-4">
                  <div className="space-y-2">
                    <Label htmlFor="p-signup-email">Business Email</Label>
                    <Input id="p-signup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="Must match your buyer account email" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="p-signup-password">Password</Label>
                    <Input id="p-signup-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Provider Account
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
              <div className="mt-6 text-center text-sm text-muted-foreground">
                Are you a homeowner? <Link to="/login" className="text-primary hover:underline font-semibold">Homeowner login →</Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />
    </>
  );
}

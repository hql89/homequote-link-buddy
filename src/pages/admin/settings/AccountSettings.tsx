import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Mail, KeyRound } from "lucide-react";

interface AccountSettingsProps {
  userEmail: string | undefined;
}

export function AccountSettings({ userEmail }: AccountSettingsProps) {
  const [newEmail, setNewEmail] = useState("");
  const [changingEmail, setChangingEmail] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  async function handleChangeEmail() {
    if (!newEmail.trim()) return;
    setChangingEmail(true);
    try {
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() });
      if (error) throw error;
      toast({ title: "Confirmation email sent", description: "Check your new inbox to confirm the change." });
      setNewEmail("");
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setChangingEmail(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmNewPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setChangingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast({ title: "Password updated", description: "Your password has been changed successfully." });
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      const error = err as Error;
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } finally {
      setChangingPassword(false);
    }
  }

  return (
    <div className="max-w-2xl rounded-lg border bg-card p-6 mb-6">
      <h2 className="font-semibold font-sans">Account</h2>
      <p className="mb-4 mt-1 text-xs text-muted-foreground">
        Your own admin sign-in. This is not the address that receives lead notifications — that one is
        set under Email Notifications below.
      </p>
      <div className="space-y-4">
        <div>
          <Label className="text-xs text-muted-foreground">Current Email</Label>
          <p className="text-sm font-medium mt-1">{userEmail ?? "—"}</p>
        </div>
        <div>
          <Label className="text-xs text-muted-foreground">New Email Address</Label>
          <div className="flex gap-2 mt-1">
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="newemail@example.com"
              className="flex-1"
            />
            <Button onClick={handleChangeEmail} disabled={changingEmail || !newEmail.trim()} className="gap-2">
              {changingEmail ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Change Email
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">A confirmation link will be sent to the new address.</p>
        </div>
        <div className="border-t pt-4">
          <Label className="text-xs text-muted-foreground">Change Password</Label>
          <div className="grid gap-2 mt-1 sm:grid-cols-2">
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
            />
            <Input
              type="password"
              value={confirmNewPassword}
              onChange={(e) => setConfirmNewPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
          <Button onClick={handleChangePassword} disabled={changingPassword || !newPassword.trim()} className="gap-2 mt-2">
            {changingPassword ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Update Password
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTheme } from "next-themes";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SEO } from "@/components/seo/SEO";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/components/ui/use-toast";
import {
  ArrowLeft,
  Laptop,
  Loader2,
  Lock,
  LogOut,
  Monitor,
  Moon,
  Sun,
  Trash2,
  User as UserIcon,
  AlertTriangle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { isSchemaMissingError } from "@/integrations/supabase/config";
import { getCurrentDeviceToken } from "@/lib/sessionTracker";
import type { UserSessionRow } from "@/hooks/useLibraryWorkspace";

export default function Settings() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [location, setLocation] = useState("");
  const [website, setWebsite] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [processingAccountAction, setProcessingAccountAction] = useState(false);

  const currentDeviceToken = typeof window !== "undefined" ? getCurrentDeviceToken() : "";

  const profileQuery = useQuery({
    queryKey: ["settings-profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username, display_name, bio, location, website, provider")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) {
        if (isSchemaMissingError(error)) return null;
        throw error;
      }
      return data;
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ["settings-sessions", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_sessions")
        .select("*")
        .eq("user_id", user!.id)
        .order("last_active", { ascending: false });
      if (error) {
        if (isSchemaMissingError(error)) return [] as UserSessionRow[];
        throw error;
      }
      return (data || []) as UserSessionRow[];
    },
  });

  useEffect(() => {
    if (profileQuery.data) {
      setDisplayName(profileQuery.data.display_name || "");
      setUsername(profileQuery.data.username || "");
      setBio(profileQuery.data.bio || "");
      setLocation(profileQuery.data.location || "");
      setWebsite(profileQuery.data.website || "");
    }
  }, [profileQuery.data]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    if (!displayName.trim() || !username.trim()) {
      toast({ title: "Required Fields", description: "Display name and username cannot be empty.", variant: "destructive" });
      return;
    }
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: displayName.trim(),
          username: username.trim().toLowerCase(),
          bio: bio.trim() || null,
          location: location.trim() || null,
          website: website.trim() || null,
        })
        .eq("id", user.id);
      if (error) throw error;
      toast({ title: "Profile Updated", description: "Your account profile has been saved." });
      void queryClient.invalidateQueries({ queryKey: ["settings-profile", user.id] });
    } catch (err) {
      toast({
        title: "Update Failed",
        description: err instanceof Error ? err.message : "Could not save profile.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: "Weak Password", description: "Password must be at least 6 characters.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Mismatch", description: "Passwords do not match.", variant: "destructive" });
      return;
    }
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password Changed", description: "Your password has been updated." });
    } catch (err) {
      toast({
        title: "Password Update Failed",
        description: err instanceof Error ? err.message : "Could not change password.",
        variant: "destructive",
      });
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    if (!user?.id) return;
    const { error } = await supabase
      .from("user_sessions")
      .delete()
      .eq("id", sessionId)
      .eq("user_id", user.id);
    if (error) {
      toast({ title: "Failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Device Session Revoked" });
    void queryClient.invalidateQueries({ queryKey: ["settings-sessions", user.id] });
  };

  const handleDeactivateAccount = async () => {
    setProcessingAccountAction(true);
    try {
      const { error } = await supabase.rpc("deactivate_my_account");
      if (error) throw error;
      toast({ title: "Account Deactivated", description: "You can reactivate anytime by signing back in." });
      await signOut();
    } catch (err) {
      toast({
        title: "Deactivation Failed",
        description: err instanceof Error ? err.message : "Try again later.",
        variant: "destructive",
      });
    } finally {
      setProcessingAccountAction(false);
      setDeactivateOpen(false);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirmText.trim().toUpperCase() !== "DELETE" || !user?.id) return;
    setProcessingAccountAction(true);
    try {
      const fn = await supabase.functions.invoke("delete-account");
      if (fn.error) {
        const rpc = await supabase.rpc("delete_user_account", { p_user_id: user.id });
        if (rpc.error) throw rpc.error;
      }
      toast({ title: "Account Deleted", description: "Your account and personal records have been removed." });
      await signOut();
    } catch (err) {
      toast({
        title: "Deletion Failed",
        description: err instanceof Error ? err.message : "Could not delete account.",
        variant: "destructive",
      });
    } finally {
      setProcessingAccountAction(false);
      setDeleteOpen(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-subtle pb-16">
      <SEO title="Account & Settings — Sha-Verse Bookshelf" description="Manage profile, theme, security, and active sessions." path="/settings" />

      <header className="sticky top-0 z-40 bg-card/85 backdrop-blur-lg border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate("/bookshelf")} aria-label="Back to Bookshelf">
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-lg sm:text-xl font-bold">Account &amp; Settings</h1>
              <p className="text-xs text-muted-foreground">{user?.email || user?.phone}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate("/dashboard")}>
            Workspace
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Profile Settings */}
        <Card className="p-5 space-y-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <UserIcon className="w-4 h-4 text-primary" />
            Profile Information
          </h2>
          <form onSubmit={handleSaveProfile} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="settings-display-name">Display Name</Label>
                <Input
                  id="settings-display-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-username">Username</Label>
                <Input
                  id="settings-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-bio">Bio</Label>
              <Textarea
                id="settings-bio"
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share your reading interests..."
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="settings-location">Location</Label>
                <Input
                  id="settings-location"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City, Country"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="settings-website">Website</Label>
                <Input
                  id="settings-website"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="https://..."
                />
              </div>
            </div>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Save Profile
            </Button>
          </form>
        </Card>

        {/* Appearance / Theme */}
        <Card className="p-5 space-y-3">
          <h2 className="text-base font-semibold">Appearance Theme</h2>
          <div className="flex flex-wrap gap-2">
            {[
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ].map((item) => (
              <Button
                key={item.id}
                type="button"
                variant={theme === item.id ? "default" : "outline"}
                onClick={() => setTheme(item.id)}
                className="gap-2"
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Button>
            ))}
          </div>
        </Card>

        {/* Security / Change Password */}
        <Card className="p-5 space-y-4">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Lock className="w-4 h-4 text-primary" />
            Security &amp; Password
          </h2>
          <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="settings-new-pass">New Password</Label>
              <Input
                id="settings-new-pass"
                type="password"
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="At least 6 characters"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settings-confirm-pass">Confirm Password</Label>
              <Input
                id="settings-confirm-pass"
                type="password"
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={updatingPassword}>
                {updatingPassword ? "Updating..." : "Change Password"}
              </Button>
            </div>
          </form>
        </Card>

        {/* Active Sessions & Devices */}
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Laptop className="w-4 h-4 text-primary" />
              Active Devices &amp; Sessions
            </h2>
            <Button variant="outline" size="sm" onClick={() => void signOut()} className="gap-1.5">
              <LogOut className="w-3.5 h-3.5" />
              Sign Out Here
            </Button>
          </div>
          <div className="space-y-2">
            {(sessionsQuery.data || []).map((s) => {
              const isThisDevice = s.session_token === currentDeviceToken || Boolean(s.is_current);
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-xs sm:text-sm">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {s.device_info || "Device"} — {s.browser || "Browser"} ({s.os || "OS"})
                      {isThisDevice && <Badge variant="secondary">Current</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Last active: {s.last_active ? new Date(s.last_active).toLocaleString() : "recently"}
                    </p>
                  </div>
                  {!isThisDevice && (
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => void handleRevokeSession(s.id)}>
                      Revoke
                    </Button>
                  )}
                </div>
              );
            })}
            {(sessionsQuery.data || []).length === 0 && (
              <p className="text-xs text-muted-foreground">No remote device sessions recorded yet.</p>
            )}
          </div>
        </Card>

        {/* Danger Zone */}
        <Card className="p-5 border-destructive/40 space-y-4">
          <h2 className="text-base font-semibold text-destructive flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            Account Lifecycle (Deactivate / Delete)
          </h2>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Deactivating pauses your profile until your next login. Permanent deletion removes your profile, shelves, and personal data permanently.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={() => setDeactivateOpen(true)}>
              Deactivate Account
            </Button>
            <Button type="button" variant="destructive" onClick={() => setDeleteOpen(true)} className="gap-1.5">
              <Trash2 className="w-4 h-4" />
              Delete Account Permanently
            </Button>
          </div>
        </Card>
      </main>

      <AlertDialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate your account?</AlertDialogTitle>
            <AlertDialogDescription>
              Your active sessions will be signed out immediately. You can reactivate anytime simply by logging back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeactivateAccount} disabled={processingAccountAction}>
              {processingAccountAction ? "Deactivating..." : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete account?</AlertDialogTitle>
            <AlertDialogDescription>
              This action is irreversible. Type <strong>DELETE</strong> below to confirm permanent account deletion.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="Type DELETE to confirm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={processingAccountAction || deleteConfirmText.trim().toUpperCase() !== "DELETE"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {processingAccountAction ? "Deleting..." : "Confirm Permanent Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AlertTriangle, ArrowLeft, Loader2, Mail, Trash2 } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { APP_OWNER_EMAIL } from "@/modules/bookshelf/lib/uploadAccess";

export default function DeleteAccount() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const { toast } = useToast();
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleDeleteNow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id || confirmText.trim().toUpperCase() !== "DELETE") return;
    setDeleting(true);
    try {
      const fn = await supabase.functions.invoke("delete-account");
      if (fn.error) {
        const rpc = await supabase.rpc("delete_user_account", { p_user_id: user.id });
        if (rpc.error) throw rpc.error;
      }
      toast({
        title: "Account Deleted",
        description: "Your Sha-Verse: Bookshelf account and personal records have been removed.",
      });
      await signOut();
      navigate("/auth");
    } catch (err) {
      toast({
        title: "Deletion Failed",
        description: err instanceof Error ? err.message : "Could not delete account right now.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const mailtoSubject = encodeURIComponent("Sha-Verse: Bookshelf — Account Deletion Request");
  const mailtoBody = encodeURIComponent(
    "Hello Sha-Verse Team,\n\nPlease permanently delete my Sha-Verse: Bookshelf (com.shaverse.bookshelf) account and all associated personal data.\n\nRegistered Email / Phone: ",
  );
  const deleteMailtoUrl = `mailto:${APP_OWNER_EMAIL}?subject=${mailtoSubject}&body=${mailtoBody}`;

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <SEO
        title="Delete Account — Sha-Verse: Bookshelf"
        description="Instructions and self-service tool to permanently delete your Sha-Verse: Bookshelf account and associated data."
        path="/delete-account"
      />

      <header className="sticky top-0 z-30 border-b border-border bg-card/85 backdrop-blur-lg">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
              aria-label="Go back"
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-bold truncate">Account &amp; Data Deletion</h1>
              <p className="text-xs text-muted-foreground truncate">Sha-Verse: Bookshelf</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/privacy">Privacy Policy</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Card className="p-5 sm:p-7 space-y-6">
          <div className="flex items-start gap-3 pb-4 border-b border-border">
            <div className="w-10 h-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
              <Trash2 className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight">Delete Your Sha-Verse: Bookshelf Account</h2>
              <p className="text-xs text-muted-foreground">
                App: Sha-Verse: Bookshelf (<span className="font-mono">com.shaverse.bookshelf</span>)
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">What Data Is Permanently Deleted</h3>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
              <li>Your authentication credentials, email/phone identifier, and active device sessions.</li>
              <li>Your profile information, author channel, and follower connections.</li>
              <li>Books, chapters, covers, bookmarks, reading progress, and comments owned by your account.</li>
            </ul>
            <p className="text-xs text-muted-foreground pt-1">
              In-app deletions execute immediately. Email deletion requests are verified and completed within
              7 business days.
            </p>
          </section>

          {user ? (
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4 space-y-4">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-destructive">
                    Signed in as {user.email || user.phone || "current user"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Type <span className="font-mono font-bold text-foreground">DELETE</span> below to
                    permanently erase your account and all associated library data. This action cannot be
                    undone.
                  </p>
                </div>
              </div>

              <form onSubmit={handleDeleteNow} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="delete-account-confirm">Confirmation</Label>
                  <Input
                    id="delete-account-confirm"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="Type DELETE to confirm"
                    autoComplete="off"
                  />
                </div>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={deleting || confirmText.trim().toUpperCase() !== "DELETE"}
                >
                  {deleting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                  Permanently Delete Account
                </Button>
              </form>
            </section>
          ) : (
            <section className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <h3 className="text-sm font-semibold">Option 1 — Delete Instantly Inside the App</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Sign in with your account and open{" "}
                <span className="font-medium text-foreground">Account &amp; Settings &rarr; Delete Account</span>,
                or sign in first and return to this page to delete immediately.
              </p>
              <Button asChild size="sm">
                <Link to="/auth">Sign In to Delete Account</Link>
              </Button>
            </section>
          )}

          <section className="rounded-xl border border-border p-4 space-y-3">
            <h3 className="text-sm font-semibold">Option 2 — Request Deletion via Email</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              If you can no longer access your device, send a deletion request from your registered email
              address to{" "}
              <a
                href={deleteMailtoUrl}
                className="text-primary underline underline-offset-2 font-medium"
              >
                {APP_OWNER_EMAIL}
              </a>
              .
            </p>
            <Button asChild variant="outline" size="sm" className="gap-2">
              <a href={deleteMailtoUrl}>
                <Mail className="w-4 h-4" />
                Email Deletion Request
              </a>
            </Button>
          </section>
        </Card>

        <footer className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          <span>&middot;</span>
          <Link to="/terms" className="hover:text-foreground underline-offset-2 hover:underline">
            Terms of Service
          </Link>
          <span>&middot;</span>
          <Link to="/delete-account" className="text-foreground font-medium">
            Delete Account
          </Link>
          <span>&middot;</span>
          <Link to="/auth" className="hover:text-foreground underline-offset-2 hover:underline">
            Sign In
          </Link>
        </footer>
      </main>
    </div>
  );
}

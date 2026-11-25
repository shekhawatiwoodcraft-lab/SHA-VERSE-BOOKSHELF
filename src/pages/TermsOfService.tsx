import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { APP_OWNER_EMAIL } from "@/modules/bookshelf/lib/uploadAccess";

const LAST_UPDATED = "November 25, 2026";

export default function TermsOfService() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <SEO
        title="Terms of Service — Sha-Verse: Bookshelf"
        description="Terms of Service for Sha-Verse: Bookshelf (com.shaverse.bookshelf), governing user accounts, uploaded books, promotions, and platform usage."
        path="/terms"
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
              <h1 className="text-base sm:text-lg font-bold truncate">Terms of Service</h1>
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
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight">Sha-Verse: Bookshelf Terms of Service</h2>
              <p className="text-xs text-muted-foreground">
                Package ID: <span className="font-mono">com.shaverse.bookshelf</span> &middot; Last updated:{" "}
                {LAST_UPDATED}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">1. Acceptance of Terms</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              By creating an account or using the Sha-Verse: Bookshelf web or Android application, you agree
              to these Terms of Service and our{" "}
              <Link to="/privacy" className="text-primary underline underline-offset-2 font-medium">
                Privacy Policy
              </Link>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">2. User Content &amp; Copyright</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You retain ownership of original books and materials you upload. By publishing content on
              Sha-Verse: Bookshelf, you confirm that you own the necessary rights or permissions to share
              that work. Copyright infringement, illegal content, harassment, or malware uploads are strictly
              prohibited and may result in immediate content removal and account suspension.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">3. AI Translation &amp; Audio Features</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              AI-powered book translation and narration tools are provided for reading convenience and
              accessibility. Automated translations may occasionally contain minor phrasing inaccuracies and
              should not be treated as certified legal, medical, or academic translations.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">4. Advertising &amp; Promotions</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              The free reading experience is supported by Google AdMob advertisements and optional sponsored
              promotions. Attempting to manipulate ad impressions, clicks, or rewarded ad timers is
              prohibited.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">5. Account Suspension &amp; Termination</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              We may suspend accounts that violate these terms. You may delete your own account at any time
              from Settings or via{" "}
              <Link to="/delete-account" className="text-primary underline underline-offset-2 font-medium">
                /delete-account
              </Link>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">6. Contact &amp; Takedown Requests</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Questions or copyright takedown notices can be sent to{" "}
              <a
                href={`mailto:${APP_OWNER_EMAIL}`}
                className="text-primary underline underline-offset-2 font-medium"
              >
                {APP_OWNER_EMAIL}
              </a>
              .
            </p>
          </section>
        </Card>

        <footer className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
          <Link to="/privacy" className="hover:text-foreground underline-offset-2 hover:underline">
            Privacy Policy
          </Link>
          <span>&middot;</span>
          <Link to="/terms" className="text-foreground font-medium">
            Terms of Service
          </Link>
          <span>&middot;</span>
          <Link to="/delete-account" className="hover:text-foreground underline-offset-2 hover:underline">
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

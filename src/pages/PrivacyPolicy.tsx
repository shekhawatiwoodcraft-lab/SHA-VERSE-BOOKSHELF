import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { SEO } from "@/components/seo/SEO";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { APP_OWNER_EMAIL } from "@/modules/bookshelf/lib/uploadAccess";

const LAST_UPDATED = "November 25, 2026";

export default function PrivacyPolicy() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      <SEO
        title="Privacy Policy — Sha-Verse: Bookshelf"
        description="Privacy Policy for Sha-Verse: Bookshelf (com.shaverse.bookshelf), explaining how user accounts, books, reading progress, and advertising data are handled."
        path="/privacy"
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
              <h1 className="text-base sm:text-lg font-bold truncate">Privacy Policy</h1>
              <p className="text-xs text-muted-foreground truncate">Sha-Verse: Bookshelf</p>
            </div>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/delete-account">Delete Account</Link>
          </Button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 space-y-6">
        <Card className="p-5 sm:p-7 space-y-6">
          <div className="flex items-start gap-3 pb-4 border-b border-border">
            <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight">Sha-Verse: Bookshelf Privacy Policy</h2>
              <p className="text-xs text-muted-foreground">
                Package ID: <span className="font-mono">com.shaverse.bookshelf</span> &middot; Last updated:{" "}
                {LAST_UPDATED}
              </p>
            </div>
          </div>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">1. Information We Collect</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              When you use Sha-Verse: Bookshelf, we collect only the information needed to operate your
              reading library and author workspace:
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Account Information:</strong> Email address, phone
                number, or Google account profile identifiers used to sign in and keep your library synced.
              </li>
              <li>
                <strong className="text-foreground">Library &amp; Reading Data:</strong> Books, PDFs, EPUBs,
                author channel profiles, bookmarks, highlights, reading progress, and comments you choose to
                upload or save.
              </li>
              <li>
                <strong className="text-foreground">Device &amp; Session Metadata:</strong> Basic device and
                session tokens used to manage active logins and protect your account from unauthorized access.
              </li>
              <li>
                <strong className="text-foreground">Advertising Data (Mobile App):</strong> On Android,
                Google AdMob may collect device advertising IDs and diagnostic signals to serve and measure
                banner, native, and rewarded ads.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">2. How We Use Information</h3>
            <ul className="list-disc pl-5 space-y-1.5 text-sm text-muted-foreground">
              <li>Authenticate your account and sync your bookshelf across web and Android.</li>
              <li>Store and deliver uploaded books, covers, and audio/reading preferences.</li>
              <li>Provide on-demand AI translation and text-to-speech playback for selected book passages.</li>
              <li>Enforce community safety, prevent spam, and display AdMob advertisements.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">3. Third-Party Services</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sha-Verse: Bookshelf relies on trusted infrastructure partners strictly for core functionality:
              Supabase (authentication, database, and file storage), Google Sign-In (optional OAuth login),
              Google AdMob (mobile advertising), and AI translation/speech synthesis endpoints used solely to
              process requested reading passages. We do not sell your personal information.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">4. Data Retention &amp; Account Deletion</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              You may permanently delete your account, profile, uploaded books, bookmarks, and active
              sessions at any time from inside the app under{" "}
              <span className="font-medium text-foreground">Account &amp; Settings &rarr; Delete Account</span>{" "}
              or via our public{" "}
              <Link to="/delete-account" className="text-primary underline underline-offset-2 font-medium">
                Account Deletion page
              </Link>
              .
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">5. Children&apos;s Privacy</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              Sha-Verse: Bookshelf is not directed at children under the age of 13 (or the applicable age of
              digital consent in your region), and we do not knowingly collect personal data from children
              without parental consent.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-semibold">6. Contact Us</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">
              For privacy inquiries, copyright notices, or data requests, email{" "}
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
          <Link to="/privacy" className="text-foreground font-medium">
            Privacy Policy
          </Link>
          <span>&middot;</span>
          <Link to="/terms" className="hover:text-foreground underline-offset-2 hover:underline">
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

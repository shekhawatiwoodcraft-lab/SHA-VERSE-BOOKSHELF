import { useCallback, useState } from 'react';
import { useRegisterBackOverlay } from '@/lib/navigation';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import {
  ArrowLeft,
  Sparkles,
  Megaphone,
  ShieldCheck,
  Zap,
  Users,
  Image as ImageIcon,
  CreditCard,
  Rocket,
  Mail,
  Copy,
  Check,
  Clock,
  Headphones,
  RotateCcw,
  HeartHandshake,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { APP_OWNER_EMAIL } from '@/hooks/useAppPromotions';
import {
  buildPromotionPricing,
  buildOwnerGmailUrl,
  type PricingRegion,
} from '@/lib/promotions/promotePricing';

interface PromoteWithUsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function PromoteWithUsSheet({ open, onOpenChange }: PromoteWithUsSheetProps) {
  const handleClose = useCallback(() => onOpenChange(false), [onOpenChange]);
  useRegisterBackOverlay(open, 'promote-with-us-sheet', handleClose);
  const [region, setRegion] = useState<PricingRegion>('INTL');
  const [selectedHours, setSelectedHours] = useState<number | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  const pricingTiers = buildPromotionPricing(region);
  const selectedTier = selectedHours
    ? pricingTiers.find((t) => t.hours === selectedHours)
    : undefined;
  const gmailComposeUrl = buildOwnerGmailUrl(
    selectedTier
      ? { hours: selectedTier.hours, priceFormatted: selectedTier.priceFormatted }
      : undefined,
  );

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(APP_OWNER_EMAIL);
      setCopied(true);
      toast.success(`Email copied: ${APP_OWNER_EMAIL}`);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy email');
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="left"
        className="w-full sm:max-w-[430px] p-0 flex flex-col bg-background border-r overflow-hidden"
      >
        {/* Top Bar matching Screenshot 19 */}
        <div className="px-4 py-3.5 pr-12 border-b flex items-center gap-2.5 bg-background shrink-0">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Back"
            className="p-1.5 rounded-lg hover:bg-muted text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <Sparkles className="w-4 h-4 text-[#1d63eb] shrink-0" />
          <SheetTitle className="text-sm font-bold text-foreground truncate">
            Promote on Sha-Verse
          </SheetTitle>
          <SheetDescription className="sr-only">
            View status promotion details, pricing, and contact the app owner directly via Gmail.
          </SheetDescription>
        </div>

        {/* Scrollable Content matching Screenshot 19 & 20 */}
        <div className="flex-1 overflow-y-auto px-4 py-5 space-y-6">
          {/* Hero */}
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-[#1d63eb] mx-auto flex items-center justify-center border border-blue-100 dark:border-blue-900/50">
              <Megaphone className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h2 className="text-xl font-extrabold tracking-tight text-foreground">
                Promote on Sha-Verse
              </h2>
              <p className="text-xs text-muted-foreground leading-relaxed max-w-xs mx-auto">
                Reach thousands of active users instantly. Your promotion shows up as a featured
                status on the Sha-Verse logo, seen by the whole community.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-blue-200 bg-blue-50/70 text-[#1d63eb] dark:bg-blue-950/30 dark:border-blue-900">
                <ShieldCheck className="w-3 h-3" />
                100% Secure Payment
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-blue-200 bg-blue-50/70 text-[#1d63eb] dark:bg-blue-950/30 dark:border-blue-900">
                <Zap className="w-3 h-3" />
                Instant Approval in 30 mins
              </span>
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium border border-blue-200 bg-blue-50/70 text-[#1d63eb] dark:bg-blue-950/30 dark:border-blue-900">
                <Users className="w-3 h-3" />
                50,000+ Active Users
              </span>
            </div>
          </div>

          {/* Highlighted Charity & Social Impact Message */}
          <div
            data-testid="promote-charity-highlight"
            className="rounded-2xl border-2 border-emerald-300 dark:border-emerald-700/80 bg-gradient-to-br from-emerald-50 via-teal-50/80 to-amber-50/70 dark:from-emerald-950/50 dark:via-teal-950/40 dark:to-amber-950/25 p-4 shadow-sm"
          >
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                <HeartHandshake className="w-5 h-5" />
              </div>
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wide bg-emerald-600 text-white">
                    60% Revenue Donated
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                    Charity &amp; Humanitarian Pledge
                  </span>
                </div>
                <p className="text-xs font-semibold leading-relaxed text-emerald-950 dark:text-emerald-50">
                  At <span className="font-extrabold">Sha-Verse: Bookshelf</span>,{' '}
                  <span className="underline decoration-emerald-500/70 decoration-2 underline-offset-2 font-extrabold">
                    60% of all promotion revenue
                  </span>{' '}
                  is donated directly to support poor, oppressed, and helpless children and people in need.
                </p>
              </div>
            </div>
          </div>

          {/* HOW IT WORKS */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
              HOW IT WORKS
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border bg-card p-3 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#1d63eb] flex items-center justify-center">
                  <ImageIcon className="w-3.5 h-3.5" />
                </div>
                <p className="text-xs font-bold leading-snug text-foreground">
                  1. Send your creative
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Share your image or video (15 sec - 5 min) and your promo link.
                </p>
              </div>
              <div className="rounded-xl border bg-card p-3 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#1d63eb] flex items-center justify-center">
                  <CreditCard className="w-3.5 h-3.5" />
                </div>
                <p className="text-xs font-bold leading-snug text-foreground">
                  2. Pick duration &amp; pay
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Choose how many hours your promo runs, then pay securely.
                </p>
              </div>
              <div className="rounded-xl border bg-card p-3 space-y-2">
                <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-[#1d63eb] flex items-center justify-center">
                  <Rocket className="w-3.5 h-3.5" />
                </div>
                <p className="text-xs font-bold leading-snug text-foreground">
                  3. Go live instantly
                </p>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Your promotion appears as a status on the Sha-Verse logo for everyone.
                </p>
              </div>
            </div>
          </div>

          {/* PRICING */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
                PRICING
              </h3>
              <div className="inline-flex rounded-lg border bg-muted/40 p-0.5 text-[11px] font-semibold">
                <button
                  type="button"
                  onClick={() => setRegion('IN')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors',
                    region === 'IN'
                      ? 'bg-[#1d63eb] text-white'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  IN India
                </button>
                <button
                  type="button"
                  onClick={() => setRegion('INTL')}
                  className={cn(
                    'px-2.5 py-1 rounded-md transition-colors',
                    region === 'INTL'
                      ? 'bg-[#1d63eb] text-white'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  International
                </button>
              </div>
            </div>

            <div className="rounded-2xl border bg-card overflow-hidden">
              <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-bold text-foreground">
                    {region === 'INTL' ? 'International (USD)' : 'India (INR)'}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {region === 'INTL'
                      ? 'No tax + 50% launch discount applied'
                      : '50% launch discount applied'}
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-900">
                  50% OFF LAUNCH
                </span>
              </div>

              <div className="divide-y">
                {pricingTiers.map((tier) => {
                  const selected = selectedHours === tier.hours;
                  return (
                    <button
                      key={tier.hours}
                      type="button"
                      onClick={() =>
                        setSelectedHours((prev) => (prev === tier.hours ? undefined : tier.hours))
                      }
                      className={cn(
                        'w-full px-4 py-2.5 flex items-center justify-between text-left transition-colors',
                        selected ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'hover:bg-muted/40',
                      )}
                    >
                      <span className="text-xs font-medium text-foreground">{tier.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-foreground">
                          {tier.priceFormatted}
                        </span>
                        <span className="text-[11px] text-muted-foreground line-through">
                          {tier.originalFormatted}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-[#1d63eb] text-[10px] font-semibold">
                          {tier.discountBadge}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* GET STARTED / CONTACT US matching Screenshot 20 */}
          <div className="space-y-2.5">
            <div>
              <h3 className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
                GET STARTED / CONTACT US
              </h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ready to promote? Reach out and our team will set you up within 30 minutes.
              </p>
            </div>

            <div className="rounded-2xl border bg-card p-3.5 space-y-3">
              <a
                href={gmailComposeUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Open Gmail to email ${APP_OWNER_EMAIL}`}
                className="flex items-center gap-2.5 min-w-0 group"
              >
                <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/50 text-[#1d63eb] flex items-center justify-center shrink-0">
                  <Mail className="w-4 h-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] text-muted-foreground">Email us instantly</p>
                  <p className="text-xs font-bold text-foreground group-hover:text-[#1d63eb] group-hover:underline truncate">
                    {APP_OWNER_EMAIL}
                  </p>
                </div>
              </a>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={handleCopyEmail}
                  className="h-8 px-3 text-xs gap-1.5 flex-1"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Email
                </Button>
                <Button
                  asChild
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 flex-1 bg-[#1d63eb] hover:bg-[#1a56cc] text-white"
                >
                  <a
                    href={gmailComposeUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="contact-team-gmail"
                  >
                    <Mail className="w-3.5 h-3.5" />
                    Contact Team
                  </a>
                </Button>
              </div>
            </div>
          </div>

          {/* WHY ADVERTISE WITH US matching Screenshot 20 */}
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-bold tracking-wider uppercase text-muted-foreground">
              WHY ADVERTISE WITH US
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1d63eb] shrink-0" />
                <span className="text-xs font-medium text-foreground">100% Secure Payment</span>
              </div>
              <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-[#1d63eb] shrink-0" />
                <span className="text-xs font-medium text-foreground">
                  Instant Approval in 30 mins
                </span>
              </div>
              <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-[#1d63eb] shrink-0" />
                <span className="text-xs font-medium text-foreground">50,000+ Active Users</span>
              </div>
              <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-[#1d63eb] shrink-0" />
                <span className="text-xs font-medium text-foreground">
                  Money-back if not delivered
                </span>
              </div>
              <div className="rounded-xl border bg-card p-3 flex items-center gap-2">
                <Headphones className="w-4 h-4 text-[#1d63eb] shrink-0" />
                <span className="text-xs font-medium text-foreground">24/7 Dedicated Support</span>
              </div>
              <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-3 flex items-center gap-2">
                <HeartHandshake className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                <span className="text-xs font-semibold text-emerald-900 dark:text-emerald-200">
                  60% Donated to Charity
                </span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-center text-muted-foreground pb-2">
            Prices shown include a 50% launch discount. Final amount confirmed at checkout.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}

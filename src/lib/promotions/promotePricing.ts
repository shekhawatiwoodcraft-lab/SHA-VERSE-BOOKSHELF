import { APP_OWNER_EMAIL } from '@/hooks/useAppPromotions';

export type PricingRegion = 'IN' | 'INTL';

export interface PricingTier {
  hours: number;
  label: string;
  priceFormatted: string;
  originalFormatted: string;
  discountBadge: string;
}

export function buildPromotionPricing(region: PricingRegion): PricingTier[] {
  const tiers: PricingTier[] = [];
  for (let hours = 1; hours <= 24; hours++) {
    const label = hours === 1 ? '1 hour' : `${hours} hours`;
    if (region === 'INTL') {
      const price = (hours * 2.99).toFixed(2);
      const original = (hours * 5.99).toFixed(2);
      tiers.push({
        hours,
        label,
        priceFormatted: `$${price}`,
        originalFormatted: `$${original}`,
        discountBadge: '50% off',
      });
    } else {
      const price = (hours * 149).toLocaleString('en-IN');
      const original = (hours * 299).toLocaleString('en-IN');
      tiers.push({
        hours,
        label,
        priceFormatted: `₹${price}`,
        originalFormatted: `₹${original}`,
        discountBadge: '50% off',
      });
    }
  }
  return tiers;
}

export function buildOwnerGmailUrl(options?: {
  hours?: number;
  priceFormatted?: string;
}): string {
  const durationNote = options?.hours
    ? `${options.hours} ${options.hours === 1 ? 'hour' : 'hours'}${options.priceFormatted ? ` (${options.priceFormatted})` : ''}`
    : null;

  const subject = durationNote
    ? `Promote on Sha-Verse — ${durationNote}`
    : 'Promote on Sha-Verse — Status Promotion Inquiry';

  const bodyLines = [
    'Hi Sha-Verse Team,',
    '',
    'I would like to feature a status promotion on the Sha-Verse Bookshelf app logo.',
    ...(durationNote ? [`Selected Plan: ${durationNote}`] : []),
    '',
    'Please share the next steps to submit my creative and go live.',
    '',
    'Thanks!',
  ];

  const params = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: APP_OWNER_EMAIL,
    su: subject,
    body: bodyLines.join('\n'),
  });

  return `https://mail.google.com/mail/?${params.toString()}`;
}

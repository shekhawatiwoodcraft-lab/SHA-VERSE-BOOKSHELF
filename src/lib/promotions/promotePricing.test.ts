import { describe, it, expect } from 'vitest';
import { buildPromotionPricing, buildOwnerGmailUrl } from './promotePricing';

describe('promotePricing helper', () => {
  it('generates 24 hourly tiers for both International and India regions', () => {
    const intl = buildPromotionPricing('INTL');
    expect(intl).toHaveLength(24);
    expect(intl[0]).toEqual({
      hours: 1,
      label: '1 hour',
      priceFormatted: '$2.99',
      originalFormatted: '$5.99',
      discountBadge: '50% off',
    });
    expect(intl[23]).toEqual({
      hours: 24,
      label: '24 hours',
      priceFormatted: '$71.76',
      originalFormatted: '$143.76',
      discountBadge: '50% off',
    });

    const india = buildPromotionPricing('IN');
    expect(india).toHaveLength(24);
    expect(india[0].priceFormatted).toBe('₹149');
    expect(india[0].originalFormatted).toBe('₹299');
  });

  it('builds a direct Gmail compose redirect URL addressed to shashaaiteam@gmail.com', () => {
    const defaultUrl = buildOwnerGmailUrl();
    const parsedDefault = new URL(defaultUrl);
    expect(parsedDefault.origin + parsedDefault.pathname).toBe('https://mail.google.com/mail/');
    expect(parsedDefault.searchParams.get('view')).toBe('cm');
    expect(parsedDefault.searchParams.get('to')).toBe('shashaaiteam@gmail.com');

    const planUrl = buildOwnerGmailUrl({ hours: 3, priceFormatted: '$8.97' });
    const parsedPlan = new URL(planUrl);
    expect(parsedPlan.searchParams.get('su')).toContain('3 hours');
    expect(parsedPlan.searchParams.get('body')).toContain('$8.97');
  });
});

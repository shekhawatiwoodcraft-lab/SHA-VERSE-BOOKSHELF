import { describe, it, expect } from 'vitest';
import { buildPromotionPricing, buildOwnerGmailUrl } from './promotePricing';

describe('promotePricing helper', () => {
  it('generates exact 24 hourly International USD tiers for all users', () => {
    const tiers = buildPromotionPricing();
    expect(tiers).toHaveLength(24);
    expect(tiers[0]).toEqual({
      hours: 1,
      label: '1 hour',
      priceFormatted: '$2.99',
      originalFormatted: '$5.99',
      discountBadge: '50% off',
    });
    expect(tiers[2]).toEqual({
      hours: 3,
      label: '3 hours',
      priceFormatted: '$8.99',
      originalFormatted: '$17.99',
      discountBadge: '50% off',
    });
    expect(tiers[9]).toEqual({
      hours: 10,
      label: '10 hours',
      priceFormatted: '$29.99',
      originalFormatted: '$59.99',
      discountBadge: '50% off',
    });
    expect(tiers[23]).toEqual({
      hours: 24,
      label: '24 hours',
      priceFormatted: '$71.99',
      originalFormatted: '$143.99',
      discountBadge: '50% off',
    });
  });

  it('builds a direct Gmail compose redirect URL addressed to shashaaiteam@gmail.com', () => {
    const defaultUrl = buildOwnerGmailUrl();
    const parsedDefault = new URL(defaultUrl);
    expect(parsedDefault.origin + parsedDefault.pathname).toBe('https://mail.google.com/mail/');
    expect(parsedDefault.searchParams.get('view')).toBe('cm');
    expect(parsedDefault.searchParams.get('to')).toBe('shashaaiteam@gmail.com');

    const planUrl = buildOwnerGmailUrl({ hours: 3, priceFormatted: '$8.99' });
    const parsedPlan = new URL(planUrl);
    expect(parsedPlan.searchParams.get('su')).toContain('3 hours');
    expect(parsedPlan.searchParams.get('body')).toContain('$8.99');
  });
});

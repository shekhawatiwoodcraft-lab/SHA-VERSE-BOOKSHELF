import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPromotionPricing, buildOwnerGmailUrl } from './promotePricing';

const EXPECTED_TIERS: Array<[string, string, string]> = [
  ['1 hour', '$2.99', '$5.99'],
  ['2 hours', '$5.99', '$11.99'],
  ['3 hours', '$8.99', '$17.99'],
  ['4 hours', '$11.99', '$23.99'],
  ['5 hours', '$14.99', '$29.99'],
  ['6 hours', '$17.99', '$35.99'],
  ['7 hours', '$20.99', '$41.99'],
  ['8 hours', '$23.99', '$47.99'],
  ['9 hours', '$26.99', '$53.99'],
  ['10 hours', '$29.99', '$59.99'],
  ['11 hours', '$32.99', '$65.99'],
  ['12 hours', '$35.99', '$71.99'],
  ['13 hours', '$38.99', '$77.99'],
  ['14 hours', '$41.99', '$83.99'],
  ['15 hours', '$44.99', '$89.99'],
  ['16 hours', '$47.99', '$95.99'],
  ['17 hours', '$50.99', '$101.99'],
  ['18 hours', '$53.99', '$107.99'],
  ['19 hours', '$56.99', '$113.99'],
  ['20 hours', '$59.99', '$119.99'],
  ['21 hours', '$62.99', '$125.99'],
  ['22 hours', '$65.99', '$131.99'],
  ['23 hours', '$68.99', '$137.99'],
  ['24 hours', '$71.99', '$143.99'],
];

test('buildPromotionPricing returns exact 1-24 hour International USD tiers', () => {
  const tiers = buildPromotionPricing();
  assert.equal(tiers.length, 24);
  for (let i = 0; i < EXPECTED_TIERS.length; i++) {
    const [label, priceFormatted, originalFormatted] = EXPECTED_TIERS[i];
    assert.deepEqual(tiers[i], {
      hours: i + 1,
      label,
      priceFormatted,
      originalFormatted,
      discountBadge: '50% off',
    });
  }
});

test('buildOwnerGmailUrl includes selected hours and USD price', () => {
  const url = new URL(buildOwnerGmailUrl({ hours: 24, priceFormatted: '$71.99' }));
  assert.equal(url.searchParams.get('su'), 'Promote on Sha-Verse — 24 hours ($71.99)');
  assert.match(url.searchParams.get('body') || '', /Selected Plan: 24 hours \(\$71\.99\)/);
});

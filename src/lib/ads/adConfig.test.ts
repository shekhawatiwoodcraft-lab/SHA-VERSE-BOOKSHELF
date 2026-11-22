import { describe, it, expect } from 'vitest';
import { ADMOB_APP_ID, ADMOB_APP_ID_LIVE } from './admobAppId';
import { AD_IDS, USE_TEST_ADS, ADS_HIDDEN } from './adConfig';
import { getAdUnitForPlacement } from './adAnalytics';
import { adUnitForPlacement } from './native/placements';

describe('SHA-VERSE: BOOKSHELF AdMob configuration', () => {
  it('uses the configured SHA-VERSE: BOOKSHELF live App ID', () => {
    expect(ADMOB_APP_ID_LIVE).toBe('ca-app-pub-2928763177849470~5546001296');
    expect(ADMOB_APP_ID).toBe('ca-app-pub-2928763177849470~5546001296');
  });

  it('maps all Bookshelf ad placements to the exact live AdMob unit IDs', () => {
    expect(USE_TEST_ADS).toBe(false);
    expect(ADS_HIDDEN).toBe(false);

    expect(AD_IDS.banner).toBe('ca-app-pub-2928763177849470/7809202558');
    expect(AD_IDS.stickyBanner).toBe('ca-app-pub-2928763177849470/3098755174');
    expect(AD_IDS.native).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(AD_IDS.rewarded).toBe('ca-app-pub-2928763177849470/2220787777');
    expect(AD_IDS.rewardedBookshelf).toBe('ca-app-pub-2928763177849470/2220787777');

    expect(getAdUnitForPlacement('bookshelf_detail_banner')).toBe('ca-app-pub-2928763177849470/7809202558');
    expect(getAdUnitForPlacement('bookshelf_reader_sticky')).toBe('ca-app-pub-2928763177849470/3098755174');
    expect(getAdUnitForPlacement('bookshelf_grid')).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(getAdUnitForPlacement('bookshelf_reader_inline')).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(getAdUnitForPlacement('bookshelf_rewarded')).toBe('ca-app-pub-2928763177849470/2220787777');

    expect(adUnitForPlacement('BS_GRID_01')).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(adUnitForPlacement('BS_DETAIL_01')).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(adUnitForPlacement('BS_DETAIL_02')).toBe('ca-app-pub-2928763177849470/4855736154');
    expect(adUnitForPlacement('BS_READER_01')).toBe('ca-app-pub-2928763177849470/4855736154');
  });
});

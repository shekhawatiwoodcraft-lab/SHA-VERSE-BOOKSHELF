/**
 * SHA-VERSE ADS CONFIG
 *
 * This file controls which ad unit IDs are used and whether ads render at all.
 * The current mode is defined ONLY by the two flags below — do not describe a
 * mode in comments, read the flags:
 *
 *   USE_TEST_ADS  true  → Google's official test ad units (safe to click)
 *                 false → LIVE_AD_IDS (real inventory, real revenue)
 *   ADS_HIDDEN    true  → nothing renders anywhere
 *                 false → ads render normally
 *
 * ⚠️ Never click your own live ads — that can permanently ban the AdMob account.
 * When testing on a device while live IDs are active, register that device as an
 * AdMob test device instead of flipping these flags.
 */

export const USE_TEST_ADS = false;

/**
 * 🙈 GLOBAL ADS VISIBILITY SWITCH
 *
 * Set to `true`  → ALL ads are hidden everywhere (nothing renders).
 * Set to `false` → ads behave exactly as before (fully restored).
 *
 * This ONLY controls visibility. No ad code, placements, IDs, frequency
 * rules, or components are removed — flipping this back to `false` brings
 * everything back exactly as it is now.
 */
export const ADS_HIDDEN = false;

// ✅ Google official test IDs — safe to click, no ban risk
const TEST_AD_IDS = {
  banner: "ca-app-pub-3940256099942544/6300978111",
  native: "ca-app-pub-3940256099942544/2247696110",
  rewarded: "ca-app-pub-3940256099942544/5224354917",
  rewardedBookshelf: "ca-app-pub-3940256099942544/5224354917",
  rewardedMovion: "ca-app-pub-3940256099942544/5224354917",
  rewardedNovachat: "ca-app-pub-3940256099942544/5224354917",
  groupBoost: "ca-app-pub-3940256099942544/5224354917",
  videoPreRoll: "ca-app-pub-3940256099942544/8691691433",
  videoMidRoll: "ca-app-pub-3940256099942544/8691691433",
  shorts: "ca-app-pub-3940256099942544/8691691433",
  sponsoredStory: "ca-app-pub-3940256099942544/2247696110",
  sponsoredGroup: "ca-app-pub-3940256099942544/2247696110",
  sponsoredSuggestion: "ca-app-pub-3940256099942544/2247696110",
  stickyBanner: "ca-app-pub-3940256099942544/6300978111",
} as const;

// ✅ Real SHA-VERSE: BOOKSHELF AdMob unit IDs (used when USE_TEST_ADS = false on Play Store launch).
// Slots without a dedicated unit reuse the closest matching real format from this app
// so no slot ever serves an empty or mismatched ID.
const LIVE_AD_IDS = {
  banner: "ca-app-pub-2928763177849470/7809202558", // INLINE/HOME BANNER
  native: "ca-app-pub-2928763177849470/4855736154", // NATIVE ADVANCED
  rewarded: "ca-app-pub-2928763177849470/2220787777", // REWARDED
  rewardedBookshelf: "ca-app-pub-2928763177849470/2220787777", // REWARDED
  rewardedMovion: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED
  rewardedNovachat: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED
  groupBoost: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED
  videoPreRoll: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED (Bookshelf app)
  videoMidRoll: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED (Bookshelf app)
  shorts: "ca-app-pub-2928763177849470/2220787777", // reuse REWARDED (Bookshelf app)
  sponsoredStory: "ca-app-pub-2928763177849470/4855736154", // reuse NATIVE ADVANCED
  sponsoredGroup: "ca-app-pub-2928763177849470/4855736154", // reuse NATIVE ADVANCED
  sponsoredSuggestion: "ca-app-pub-2928763177849470/4855736154", // reuse NATIVE ADVANCED
  stickyBanner: "ca-app-pub-2928763177849470/3098755174", // STICKY BANNER
} as const;

export const AD_IDS = USE_TEST_ADS ? TEST_AD_IDS : LIVE_AD_IDS;

export const AD_FREQUENCY = {
  MAX_PER_DAY: 20,
  MIN_GAP_HOURS_SAME_AD: 2,
  HIDE_BLOCK_HOURS: 24,
  NEW_USER_REDUCTION_HOURS: 48,
  NEW_USER_FREQUENCY_MULTIPLIER: 0.5,
  // Slot intervals (UI-optimized)
  HOME_FEED_EVERY_N_POSTS: 5,
  MOVION_GRID_EVERY_N_VIDEOS: 6,
  SHORTS_EVERY_N: 6,
  BOOKSHELF_GRID_EVERY_N: 4, // Every 4 books (2 rows in 2-col grid)
  GROUP_LIST_POSITION: 3, // 3rd position specifically
  GROUP_FEED_EVERY_N_POSTS: 5,
  PROFILE_POSTS_EVERY_N: 4, // Every 4 posts
  READER_PAGES_PER_AD: 20,
} as const;

export const REWARDED_AD_REWARDS = {
  novachat_messages: { value: 10, expires_minutes: null },
  bookshelf_premium: { value: 1, expires_minutes: 15 },
  movion_ad_free: { value: 1, expires_minutes: 60 },
  group_post_boost: { value: 1, expires_minutes: 1440 },
} as const;

if (typeof window !== "undefined" && USE_TEST_ADS) {
  // eslint-disable-next-line no-console
  console.warn(
    "🧪 TEST ADS MODE ACTIVE — Real ads disabled. Switch USE_TEST_ADS=false in src/lib/ads/adConfig.ts before Play Store launch.",
  );
}

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shaverse.bookshelf",
  appName: "SHA-VERSE: Bookshelf",
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
};

export default config;

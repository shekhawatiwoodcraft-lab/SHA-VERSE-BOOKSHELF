export interface BrowserVoiceInfo {
  voiceURI: string;
  name: string;
  lang: string;
  localService: boolean;
  default: boolean;
}

/**
 * Splits narration text into <= maxChars chunks on sentence or clause boundaries
 * so browser Web Speech API synthesis never stalls on Chrome's ~15-second limit.
 */
export function chunkSpeechText(text: string, maxChars = 165): string[] {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= maxChars) return [clean];

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < clean.length) {
    if (cursor + maxChars >= clean.length) {
      const tail = clean.slice(cursor).trim();
      if (tail) chunks.push(tail);
      break;
    }

    const windowStr = clean.slice(cursor, cursor + maxChars);
    let cut = Math.max(
      windowStr.lastIndexOf(". "),
      windowStr.lastIndexOf("। "),
      windowStr.lastIndexOf("؟ "),
      windowStr.lastIndexOf("! "),
      windowStr.lastIndexOf("? "),
      windowStr.lastIndexOf("。"),
      windowStr.lastIndexOf("！"),
      windowStr.lastIndexOf("？"),
    );

    if (cut < maxChars * 0.4) {
      cut = Math.max(
        windowStr.lastIndexOf(", "),
        windowStr.lastIndexOf("; "),
        windowStr.lastIndexOf("، "),
        windowStr.lastIndexOf(": "),
      );
    }

    if (cut < maxChars * 0.3) {
      cut = windowStr.lastIndexOf(" ");
    }

    if (cut < 12) {
      cut = maxChars;
    } else {
      cut += 1;
    }

    const part = clean.slice(cursor, cursor + cut).trim();
    if (part) chunks.push(part);
    cursor += cut;
  }

  return chunks;
}

function normalizeLangTag(tag: string): string {
  return (tag || "").trim().toLowerCase().replace(/_/g, "-");
}

function baseLangTag(tag: string): string {
  return normalizeLangTag(tag).split("-")[0] || "en";
}

/**
 * Selects the highest-quality matching browser SpeechSynthesisVoice for a language code.
 */
export function pickBestBrowserVoice<T extends BrowserVoiceInfo>(
  voices: T[],
  languageCode: string,
  preferredVoiceUri?: string,
): T | null {
  if (!voices.length) return null;

  const targetFull = normalizeLangTag(languageCode);
  const targetBase = baseLangTag(languageCode);

  if (preferredVoiceUri) {
    const chosen = voices.find((v) => v.voiceURI === preferredVoiceUri);
    if (chosen && baseLangTag(chosen.lang) === targetBase) {
      return chosen;
    }
  }

  const scored = voices.map((voice) => {
    const vFull = normalizeLangTag(voice.lang);
    const vBase = baseLangTag(voice.lang);
    let score = 0;

    if (vFull === targetFull) score += 100;
    else if (vBase === targetBase) score += 70;
    else if (targetBase === "ur" && vBase === "hi") score += 20;

    if (/natural|neural|online|google|microsoft|enhanced|premium/i.test(voice.name)) {
      score += 18;
    }
    if (voice.localService) score += 4;
    if (voice.default && vBase === targetBase) score += 6;

    return { voice, score };
  });

  scored.sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].voice;
  return voices.find((v) => v.default) ?? voices[0] ?? null;
}

export function listBrowserVoicesForLanguage(languageCode: string): {
  matching: BrowserVoiceInfo[];
  all: BrowserVoiceInfo[];
  hasExactOrBaseMatch: boolean;
} {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return { matching: [], all: [], hasExactOrBaseMatch: false };
  }
  const raw = window.speechSynthesis.getVoices() || [];
  const all: BrowserVoiceInfo[] = raw.map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    localService: v.localService,
    default: v.default,
  }));

  const targetBase = baseLangTag(languageCode);
  const matching = all.filter((v) => baseLangTag(v.lang) === targetBase);
  return {
    matching,
    all,
    hasExactOrBaseMatch: matching.length > 0,
  };
}

export function isWebSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

export interface WebSpeechSpeakOptions {
  text: string;
  language: string;
  rate: number;
  volume: number;
  preferredVoiceUri?: string;
  onStart?: (estimatedDurationSec: number) => void;
  onProgress?: (elapsedSec: number, totalSec: number) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
}

export class WebSpeechController {
  private cancelled = false;
  private paused = false;
  private progressTimer: number | null = null;
  private keepAliveTimer: number | null = null;
  private currentRate = 1;
  private currentVolume = 1;
  private activeToken = 0;

  private clearTimers() {
    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }
    if (this.keepAliveTimer !== null) {
      window.clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }

  cancel() {
    this.activeToken += 1;
    this.cancelled = true;
    this.paused = false;
    this.clearTimers();
    if (isWebSpeechSupported()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
  }

  pause() {
    this.paused = true;
    this.clearTimers();
    if (isWebSpeechSupported()) {
      try {
        window.speechSynthesis.pause();
      } catch {
        /* ignore */
      }
    }
  }

  resume() {
    this.paused = false;
    if (isWebSpeechSupported()) {
      try {
        window.speechSynthesis.resume();
      } catch {
        /* ignore */
      }
    }
  }

  setRate(rate: number) {
    this.currentRate = Math.min(2.0, Math.max(0.5, rate || 1));
  }

  setVolume(vol: number) {
    this.currentVolume = Math.min(1, Math.max(0, vol));
  }

  async speak(opts: WebSpeechSpeakOptions): Promise<void> {
    if (!isWebSpeechSupported()) {
      opts.onError?.("Browser speech synthesis is unavailable on this device.");
      return;
    }

    this.cancel();
    const myToken = this.activeToken;
    this.cancelled = false;
    this.paused = false;
    this.currentRate = Math.min(2.0, Math.max(0.5, opts.rate || 1));
    this.currentVolume = Math.min(1, Math.max(0, opts.volume));

    const chunks = chunkSpeechText(opts.text, 165);
    if (chunks.length === 0) {
      opts.onEnded?.();
      return;
    }

    const totalChars = Math.max(1, opts.text.trim().length);
    // Roughly ~13 chars/sec at 1x speed
    const estimatedTotalSec = Math.max(1.2, totalChars / (13 * this.currentRate));
    let elapsedChars = 0;

    const synth = window.speechSynthesis;
    let rawVoices = synth.getVoices();
    if (!rawVoices.length) {
      rawVoices = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          synth.removeEventListener?.("voiceschanged", onVoicesChanged);
          resolve(synth.getVoices());
        };
        const onVoicesChanged = () => finish();
        synth.addEventListener?.("voiceschanged", onVoicesChanged);
        window.setTimeout(finish, 400);
      });
    }
    const mappedVoices: Array<BrowserVoiceInfo & { _native: SpeechSynthesisVoice }> = rawVoices.map((v) => ({
      voiceURI: v.voiceURI,
      name: v.name,
      lang: v.lang,
      localService: v.localService,
      default: v.default,
      _native: v,
    }));
    const bestVoice = pickBestBrowserVoice(mappedVoices, opts.language, opts.preferredVoiceUri);

    opts.onStart?.(estimatedTotalSec);

    const startedAtMs = Date.now();
    this.progressTimer = window.setInterval(() => {
      if (this.cancelled || this.paused || this.activeToken !== myToken) return;
      const elapsedSec = Math.min(estimatedTotalSec, (Date.now() - startedAtMs) / 1000);
      opts.onProgress?.(elapsedSec, estimatedTotalSec);
    }, 350);

    // Chrome/Linux keep-alive workaround prevents 15s silent stall during long playback
    this.keepAliveTimer = window.setInterval(() => {
      if (this.cancelled || this.paused || this.activeToken !== myToken) return;
      if (synth.speaking && !synth.paused) {
        try {
          synth.pause();
          synth.resume();
        } catch {
          /* ignore */
        }
      }
    }, 10_000);

    for (let i = 0; i < chunks.length; i++) {
      if (this.cancelled || this.activeToken !== myToken) return;
      const chunk = chunks[i];

      await new Promise<void>((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(chunk);
        utterance.lang = bestVoice?.lang || opts.language || "en-US";
        if (bestVoice?._native) {
          utterance.voice = bestVoice._native;
        }
        utterance.rate = this.currentRate;
        utterance.volume = this.currentVolume;

        let settled = false;
        const done = (errMsg?: string) => {
          if (settled) return;
          settled = true;
          if (errMsg) reject(new Error(errMsg));
          else resolve();
        };

        utterance.onend = () => done();
        utterance.onerror = (ev) => {
          const reason = (ev as SpeechSynthesisErrorEvent)?.error || "speech_error";
          if (reason === "canceled" || reason === "interrupted") {
            done();
          } else if (
            (reason === "synthesis-failed" || reason === "audio-hardware" || reason === "voice-unavailable") &&
            mappedVoices.length === 0
          ) {
            done(
              "No system TTS voices are installed in this browser environment (and Studio AI TTS is rate-limited). Try again shortly or open on Chrome, Edge, or Android with device voices enabled.",
            );
          } else {
            done(`Device speech error: ${reason}`);
          }
        };

        try {
          synth.speak(utterance);
        } catch (err) {
          done(err instanceof Error ? err.message : "Failed to start device speech.");
        }
      }).catch((err) => {
        if (!this.cancelled && this.activeToken === myToken) {
          this.clearTimers();
          opts.onError?.(err instanceof Error ? err.message : "Device voice playback failed.");
        }
        throw err;
      });

      elapsedChars += chunk.length;
      if (!this.cancelled && this.activeToken === myToken) {
        const approxElapsed = Math.min(estimatedTotalSec, (elapsedChars / totalChars) * estimatedTotalSec);
        opts.onProgress?.(approxElapsed, estimatedTotalSec);
      }
    }

    if (!this.cancelled && this.activeToken === myToken) {
      this.clearTimers();
      opts.onEnded?.();
    }
  }
}

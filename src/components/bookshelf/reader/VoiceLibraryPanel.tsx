import { useEffect, useRef, useState } from "react";
import {
  NARRATION_STYLES,
  VOICE_LIBRARY,
  getLanguageMeta,
  type GeminiPrebuiltVoiceId,
  type NarrationStyleId,
  type VoiceProfile,
} from "@/lib/ai/languages";
import { generateVoicePreviewWav, AiServiceError } from "@/lib/ai/client";
import { hashTextContent } from "@/lib/ai/segments";
import {
  loadCachedAudioSegment,
  saveCachedAudioSegment,
  type UserVoicePreferences,
} from "@/lib/ai/cache";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

interface VoiceLibraryPanelProps {
  languageCode: string;
  preferences: UserVoicePreferences;
  onSelectVoice: (voiceId: GeminiPrebuiltVoiceId) => void;
  onSelectStyle: (style: NarrationStyleId) => void;
  onUpdatePreferences: (patch: Partial<UserVoicePreferences>) => void;
  onBeforePreview?: () => void;
  surfaceBg?: string;
  surfaceText?: string;
  borderColor?: string;
}

export default function VoiceLibraryPanel({
  languageCode,
  preferences,
  onSelectVoice,
  onSelectStyle,
  onUpdatePreferences,
  onBeforePreview,
}: VoiceLibraryPanelProps) {
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const previewAbortRef = useRef<AbortController | null>(null);

  const langMeta = getLanguageMeta(languageCode);

  useEffect(() => {
    return () => {
      previewAbortRef.current?.abort();
      previewAudioRef.current?.pause();
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  const stopPreview = () => {
    previewAbortRef.current?.abort();
    previewAbortRef.current = null;
    previewAudioRef.current?.pause();
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPlayingVoice(null);
  };

  const primePreviewAudio = () => {
    if (!previewAudioRef.current) {
      previewAudioRef.current = new Audio();
    }
    const audio = previewAudioRef.current;
    if (audio.paused) {
      try {
        audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
        const p = audio.play();
        if (p && typeof p.then === "function") {
          void p
            .then(() => {
              if (audio.src.startsWith("data:")) {
                audio.pause();
                audio.currentTime = 0;
              }
            })
            .catch(() => {});
        }
      } catch {
        /* ignore gesture priming failures */
      }
    }
  };

  const handlePreviewVoice = async (voice: VoiceProfile) => {
    if (playingVoice === voice.id) {
      stopPreview();
      return;
    }

    onBeforePreview?.();
    stopPreview();
    primePreviewAudio();
    setPreviewError(null);
    setPreviewingVoice(voice.id);
    const controller = new AbortController();
    previewAbortRef.current = controller;

    try {
      const sampleText = langMeta.code === "en" ? voice.exampleText : langMeta.previewPhrase;
      const cacheKey = hashTextContent(
        `preview:${langMeta.code}:${voice.id}:${preferences.preferredStyle}:${sampleText}`,
      );
      let blob = await loadCachedAudioSegment(cacheKey);
      if (!blob) {
        blob = await generateVoicePreviewWav({
          language: langMeta.code,
          voiceId: voice.id,
          style: preferences.preferredStyle,
          sampleText,
          signal: controller.signal,
        });
        if (blob && blob.size > 44) {
          void saveCachedAudioSegment(cacheKey, blob);
        }
      }

      if (controller.signal.aborted) return;
      if (!blob || blob.size <= 44) {
        throw new Error("Voice preview audio was empty.");
      }

      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;

      if (!previewAudioRef.current) {
        previewAudioRef.current = new Audio();
      }
      const audio = previewAudioRef.current;
      audio.src = url;
      audio.onended = () => setPlayingVoice(null);
      audio.onerror = () => {
        setPlayingVoice(null);
        setPreviewError("Unable to decode voice preview audio.");
      };
      await audio.play();
      setPlayingVoice(voice.id);
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError" || controller.signal.aborted) return;
      if (err instanceof AiServiceError && err.code === "AI_NOT_CONFIGURED") {
        setPreviewError("Voice previews require GEMINI_API_KEY configured in server Settings > Secrets.");
      } else {
        setPreviewError(err instanceof Error ? err.message : "Could not generate voice preview.");
      }
    } finally {
      if (previewAbortRef.current === controller) {
        setPreviewingVoice(null);
      }
    }
  };

  return (
    <div className="space-y-5 text-sm">
      <div className="pb-2 border-b border-border/60">
        <p className="font-medium text-xs uppercase tracking-wider opacity-70">
          Voice Narration Language
        </p>
        <p className="text-sm font-semibold mt-0.5">
          {langMeta.name} ({langMeta.nativeName})
        </p>
      </div>

      {previewError && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {previewError}
        </div>
      )}

      {/* 18 Voice Profiles with Examples — Clicking any voice immediately auto-starts the book */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wider opacity-70">
            Natural Voices ({VOICE_LIBRARY.length})
          </p>
          <span className="text-[11px] opacity-70">Tap voice to start book</span>
        </div>
        <div className="space-y-2">
          {VOICE_LIBRARY.map((voice) => {
            const isSelected = preferences.preferredVoice === voice.id;
            const isLoadingPreview = previewingVoice === voice.id;
            const isPlaying = playingVoice === voice.id;
            return (
              <div
                key={voice.id}
                className={cn(
                  "rounded-lg border p-3 transition-colors flex items-start justify-between gap-3",
                  isSelected ? "border-primary bg-primary/5" : "border-border/70 hover:bg-muted/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    stopPreview();
                    onSelectVoice(voice.id);
                  }}
                  aria-pressed={isSelected}
                  className="flex-1 text-left min-w-0"
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">{voice.name}</span>
                    <span className="text-[11px] opacity-70">· {voice.genderPresentation}</span>
                    {isSelected && (
                      <span className="text-[11px] font-semibold text-primary">· Selected</span>
                    )}
                  </div>
                  <p className="text-xs opacity-80 mt-0.5">{voice.timbre}</p>
                  <p className="text-[11px] opacity-75 italic mt-1" dir={langMeta.dir}>
                    Example: "{langMeta.code === "en" ? voice.exampleText : langMeta.previewPhrase}"
                  </p>
                  <p className="text-[11px] opacity-60 mt-0.5">{voice.recommendedFor}</p>
                </button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isLoadingPreview}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePreviewVoice(voice);
                  }}
                  className="h-8 px-2.5 text-xs shrink-0 whitespace-nowrap"
                >
                  {isLoadingPreview ? "Loading..." : isPlaying ? "Stop" : "Example"}
                </Button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Narration Style */}
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider opacity-70">Narration Style</p>
        <div className="grid grid-cols-2 gap-1.5">
          {NARRATION_STYLES.map((style) => {
            const active = preferences.preferredStyle === style.id;
            return (
              <button
                key={style.id}
                type="button"
                onClick={() => onSelectStyle(style.id)}
                className={cn(
                  "rounded-md border px-2.5 py-2 text-left text-xs transition-colors",
                  active
                    ? "border-primary bg-primary/10 font-semibold"
                    : "border-border/70 hover:bg-muted/40",
                )}
              >
                {style.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Dual-Voice Dialogue Mode */}
      <div className="rounded-lg border border-border/70 p-3 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <Label htmlFor="dialogue-mode-toggle" className="text-xs font-semibold">
              Dual-Voice Quoted Dialogue
            </Label>
            <p className="text-[11px] opacity-70">
              Separates narration from quoted dialogue using a secondary character voice.
            </p>
          </div>
          <Switch
            id="dialogue-mode-toggle"
            checked={preferences.dialogueMode}
            onCheckedChange={(checked) => onUpdatePreferences({ dialogueMode: checked })}
          />
        </div>

        {preferences.dialogueMode && (
          <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2">
            <span className="text-xs opacity-75">Dialogue character voice</span>
            <select
              aria-label="Dialogue character voice"
              value={preferences.preferredSecondaryVoice}
              onChange={(e) =>
                onUpdatePreferences({
                  preferredSecondaryVoice: e.target.value as GeminiPrebuiltVoiceId,
                })
              }
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              {VOICE_LIBRARY.filter((v) => v.id !== preferences.preferredVoice).map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} ({v.genderPresentation})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

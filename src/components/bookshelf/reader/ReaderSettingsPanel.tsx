import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  READER_FONT_STACKS,
  READER_THEMES,
  type PageSpreadMode,
  type PageTransitionStyle,
  type ReaderFont,
  type ReaderSettings,
  type ReaderTheme,
  type ReadingMode,
} from "@/lib/reader/settings";

interface Props {
  settings: ReaderSettings;
  onChange: <K extends keyof ReaderSettings>(key: K, value: ReaderSettings[K]) => void;
  onReset: () => void;
  /** Which reader engine is currently active, so irrelevant typography sliders stay hidden on fixed Original PDF. */
  engineMode?: "reflow" | "epub" | "pdf-original";
}

const THEME_ORDER: ReaderTheme[] = ["light", "warm", "cream", "sepia", "dark", "black"];

const FONT_LABELS: Record<ReaderFont, string> = {
  publisher: "Book",
  serif: "Georgia",
  literata: "Palatino",
  sans: "Sans",
  dyslexic: "Easy",
};

const READING_MODES: { value: ReadingMode; label: string }[] = [
  { value: "paged", label: "Paged Book" },
  { value: "scroll", label: "Scroll" },
];

const SPREAD_MODES: { value: PageSpreadMode; label: string }[] = [
  { value: "auto", label: "Auto (2-Page)" },
  { value: "single", label: "Single Page" },
];

const TRANSITION_STYLES: { value: PageTransitionStyle; label: string }[] = [
  { value: "slide", label: "Slide" },
  { value: "curl", label: "Curl" },
  { value: "fade", label: "Fade" },
  { value: "none", label: "Instant" },
];

const MARGIN_LABELS = ["Narrow", "Normal", "Wide", "Extra Wide"];

const ReaderSettingsPanel = ({ settings, onChange, onReset, engineMode = "reflow" }: Props) => {
  const supportsReflowTypography = engineMode === "reflow" || engineMode === "epub";

  return (
    <div className="space-y-5 py-4">
      {supportsReflowTypography && (
        <>
          <div>
            <p className="mb-2.5 text-sm font-medium">Reading flow</p>
            <div className="grid grid-cols-2 gap-2">
              {READING_MODES.map((mode) => (
                <Button
                  key={mode.value}
                  variant={settings.readingMode === mode.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => onChange("readingMode", mode.value)}
                  aria-pressed={settings.readingMode === mode.value}
                >
                  {mode.label}
                </Button>
              ))}
            </div>
          </div>

          {settings.readingMode === "paged" && (
            <>
              <div>
                <p className="mb-2.5 text-sm font-medium">Page layout (Tablet / Desktop)</p>
                <div className="grid grid-cols-2 gap-2">
                  {SPREAD_MODES.map((mode) => (
                    <Button
                      key={mode.value}
                      variant={settings.pageSpread === mode.value ? "default" : "outline"}
                      size="sm"
                      onClick={() => onChange("pageSpread", mode.value)}
                      aria-pressed={settings.pageSpread === mode.value}
                    >
                      {mode.label}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2.5 text-sm font-medium">Page turn effect</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {TRANSITION_STYLES.map((item) => (
                    <Button
                      key={item.value}
                      variant={settings.pageTransition === item.value ? "default" : "outline"}
                      size="sm"
                      className="px-2 text-xs"
                      onClick={() => onChange("pageTransition", item.value)}
                      aria-pressed={settings.pageTransition === item.value}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}

      <div>
        <p className="mb-2.5 text-sm font-medium">Paper &amp; Eye Comfort theme</p>
        <div className="grid grid-cols-3 gap-2">
          {THEME_ORDER.map((theme) => {
            const preset = READER_THEMES[theme];
            const active = settings.theme === theme;
            return (
              <button
                key={theme}
                type="button"
                onClick={() => onChange("theme", theme)}
                className={cn(
                  "flex h-14 flex-col items-center justify-center rounded-lg border-2 text-xs font-medium transition-all",
                  active ? "border-primary ring-2 ring-primary/25" : "border-border hover:border-primary/40"
                )}
                style={{ backgroundColor: preset.bg, color: preset.text }}
                aria-pressed={active}
              >
                <span style={{ fontSize: 15, fontWeight: 700 }}>Aa</span>
                <span className="mt-0.5 text-[10px] opacity-85">{preset.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>Reading surface brightness</span>
            <span className="text-xs text-muted-foreground">
              {Math.round((settings.brightness ?? 1) * 100)}%
            </span>
          </p>
          <Slider
            value={[Math.round((settings.brightness ?? 1) * 100)]}
            onValueChange={([value]) => onChange("brightness", value / 100)}
            min={50}
            max={100}
            step={5}
          />
        </div>

        <div>
          <p className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>Warm paper tint</span>
            <span className="text-xs text-muted-foreground">
              {Math.round(((settings.warmth ?? 0) / 0.35) * 100)}%
            </span>
          </p>
          <Slider
            value={[Math.round((settings.warmth ?? 0) * 100)]}
            onValueChange={([value]) => onChange("warmth", value / 100)}
            min={0}
            max={35}
            step={5}
          />
        </div>
      </div>

      {supportsReflowTypography && (
        <>
          <Separator />

          <div>
            <p className="mb-2.5 text-sm font-medium">Font style</p>
            <div className="grid grid-cols-5 gap-1.5">
              {(Object.keys(FONT_LABELS) as ReaderFont[]).map((font) => (
                <Button
                  key={font}
                  variant={settings.font === font ? "default" : "outline"}
                  size="sm"
                  className="px-1.5 text-xs"
                  onClick={() => onChange("font", font)}
                  style={{ fontFamily: READER_FONT_STACKS[font] }}
                  aria-pressed={settings.font === font}
                >
                  {FONT_LABELS[font]}
                </Button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-2.5 text-sm font-medium">Text size · {settings.fontSize}px</p>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                className="w-9 h-9 px-0 text-base font-semibold"
                aria-label="Decrease text size"
                onClick={() => onChange("fontSize", Math.max(settings.fontSize - 1, 12))}
              >
                −
              </Button>
              <Slider
                value={[settings.fontSize]}
                onValueChange={([value]) => onChange("fontSize", value)}
                min={12}
                max={34}
                step={1}
                className="flex-1"
              />
              <Button
                variant="outline"
                size="sm"
                className="w-9 h-9 px-0 text-base font-semibold"
                aria-label="Increase text size"
                onClick={() => onChange("fontSize", Math.min(settings.fontSize + 1, 34))}
              >
                +
              </Button>
            </div>
          </div>

          <div>
            <p className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Line spacing</span>
              <span className="text-xs text-muted-foreground">{settings.lineHeight.toFixed(2)}×</span>
            </p>
            <Slider
              value={[Math.round(settings.lineHeight * 100)]}
              onValueChange={([value]) => onChange("lineHeight", value / 100)}
              min={125}
              max={220}
              step={5}
            />
          </div>

          <div>
            <p className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Page margins</span>
              <span className="text-xs text-muted-foreground">
                {MARGIN_LABELS[settings.margin] ?? "Normal"}
              </span>
            </p>
            <Slider
              value={[settings.margin]}
              onValueChange={([value]) => onChange("margin", value)}
              min={0}
              max={3}
              step={1}
            />
          </div>

          <div>
            <p className="mb-2 flex items-center justify-between text-sm font-medium">
              <span>Paragraph spacing</span>
              <span className="text-xs text-muted-foreground">{settings.paragraphSpacing.toFixed(1)}em</span>
            </p>
            <Slider
              value={[Math.round(settings.paragraphSpacing * 10)]}
              onValueChange={([value]) => onChange("paragraphSpacing", value / 10)}
              min={2}
              max={18}
              step={1}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <label htmlFor="reader-justify" className="text-sm font-medium">
              Justified alignment
            </label>
            <Switch
              id="reader-justify"
              checked={settings.justify}
              onCheckedChange={(checked) => onChange("justify", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="reader-indent" className="text-sm font-medium">
              First-line paragraph indent
            </label>
            <Switch
              id="reader-indent"
              checked={settings.firstLineIndent}
              onCheckedChange={(checked) => onChange("firstLineIndent", checked)}
            />
          </div>

          <div className="flex items-center justify-between">
            <label htmlFor="reader-spacing" className="text-sm font-medium">
              Extra letter spacing
            </label>
            <Switch
              id="reader-spacing"
              checked={settings.looseSpacing}
              onCheckedChange={(checked) => onChange("looseSpacing", checked)}
            />
          </div>
        </>
      )}

      <Button variant="ghost" className="w-full" onClick={onReset}>
        Reset reading appearance
      </Button>
    </div>
  );
};

export default ReaderSettingsPanel;

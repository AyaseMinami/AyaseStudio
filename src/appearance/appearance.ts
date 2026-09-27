import { focusFromLegacyCrop, normalizeBackgroundFocus, type BackgroundFocus } from "./backgroundFocus";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemeMode, "system">;
export type BackgroundFit = "cover" | "contain";

export interface AppearancePreferences {
  themeMode: ThemeMode;
  accentColor: string | null;
  canvasColor: string | null;
  assistantBubbleColor: string | null;
  unifiedTransparency: number;
  sidebarTransparency: number;
  composerTransparency: number;
  // Shared by user and assistant message backgrounds; assistant color remains separate.
  assistantBubbleTransparency: number;
  backgroundReference: string | null;
  backgroundFocus: BackgroundFocus | null;
  backgroundFit: BackgroundFit;
  backgroundMask: number;
  backgroundBlur: number;
}

export interface AppearanceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeTarget {
  style: {
    colorScheme: string;
    removeProperty(name: string): void;
    setProperty(name: string, value: string): void;
  };
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
}

export interface SystemThemeSource {
  isDark(): boolean;
  subscribe(listener: (prefersDark: boolean) => void): () => void;
}

export interface BackgroundResource {
  reference: string;
  url: string;
}

export interface BackgroundDraft extends BackgroundResource {
  focus: BackgroundFocus | null;
}

export interface BackgroundResourceStore {
  selectAndImport(): Promise<BackgroundResource | null>;
  resolve(reference: string): Promise<BackgroundResource>;
  cleanup(retainedReferences: readonly string[]): Promise<void>;
}

export class BackgroundResourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackgroundResourceError";
  }
}

export type BackgroundStatus = "none" | "loading" | "ready" | "error";

export interface AppearanceSnapshot extends AppearancePreferences {
  resolvedTheme: ResolvedTheme;
  effectiveAccentColor: string;
  effectiveCanvasColor: string;
  readabilityWarnings: string[];
  backgroundUrl: string | null;
  backgroundStatus: BackgroundStatus;
  backgroundBusy: boolean;
  backgroundError: string | null;
  backgroundDraft: BackgroundDraft | null;
}

export interface AppearanceController {
  ready: Promise<void>;
  getSnapshot(): AppearanceSnapshot;
  subscribe(listener: () => void): () => void;
  setThemeMode(themeMode: ThemeMode): void;
  setAccentColor(color: string | null): void;
  setCanvasColor(color: string | null): void;
  setAssistantBubbleColor(color: string | null): void;
  setUnifiedTransparency(transparency: number): void;
  setSidebarTransparency(transparency: number): void;
  setComposerTransparency(transparency: number): void;
  setAssistantBubbleTransparency(transparency: number): void;
  setBackgroundFit(fit: BackgroundFit): void;
  setBackgroundMask(mask: number): void;
  setBackgroundBlur(blur: number): void;
  selectBackground(): Promise<void>;
  editBackgroundFocus(): void;
  confirmBackgroundFocus(focus: BackgroundFocus): Promise<void>;
  cancelBackgroundFocus(): Promise<void>;
  removeBackground(): Promise<void>;
  resetCustomAppearance(): Promise<void>;
  destroy(): void;
}

export const APPEARANCE_STORAGE_KEY = "ayase-studio.appearance.v1";

export const defaultAppearancePreferences: Readonly<AppearancePreferences> = {
  themeMode: "system",
  accentColor: null,
  canvasColor: null,
  assistantBubbleColor: null,
  unifiedTransparency: 0,
  sidebarTransparency: 0,
  composerTransparency: 0,
  assistantBubbleTransparency: 6,
  backgroundReference: null,
  backgroundFocus: null,
  backgroundFit: "cover",
  backgroundMask: 65,
  backgroundBlur: 0,
};

function normalizeHexColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

function isBackgroundReference(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^backgrounds\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpg|webp)$/i.test(
      value,
    )
  );
}

function numberInRange(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
    ? value
    : fallback;
}

function transparencyInRange(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100
    ? value : fallback;
}

export function loadAppearancePreferences(
  storage: AppearanceStorage,
): AppearancePreferences {
  try {
    const stored = JSON.parse(storage.getItem(APPEARANCE_STORAGE_KEY) ?? "null") as
      | (Partial<AppearancePreferences> & { backgroundCrop?: unknown })
      | null;

    if (stored === null || typeof stored !== "object") {
      return { ...defaultAppearancePreferences };
    }

    const sidebarTransparency = transparencyInRange(stored.sidebarTransparency, defaultAppearancePreferences.sidebarTransparency);
    const composerTransparency = transparencyInRange(stored.composerTransparency, defaultAppearancePreferences.composerTransparency);
    const assistantBubbleTransparency = transparencyInRange(stored.assistantBubbleTransparency, defaultAppearancePreferences.assistantBubbleTransparency);
    const unifiedTransparency = sidebarTransparency === composerTransparency && sidebarTransparency === assistantBubbleTransparency
      ? sidebarTransparency
      : transparencyInRange(stored.unifiedTransparency, defaultAppearancePreferences.unifiedTransparency);

    return {
      themeMode:
        stored.themeMode === "light" ||
        stored.themeMode === "dark" ||
        stored.themeMode === "system"
          ? stored.themeMode
          : defaultAppearancePreferences.themeMode,
      accentColor: normalizeHexColor(stored.accentColor),
      canvasColor: normalizeHexColor(stored.canvasColor),
      assistantBubbleColor: normalizeHexColor(stored.assistantBubbleColor),
      unifiedTransparency,
      sidebarTransparency,
      composerTransparency,
      assistantBubbleTransparency,
      backgroundReference: isBackgroundReference(stored.backgroundReference)
        ? stored.backgroundReference
        : null,
      backgroundFocus: isBackgroundReference(stored.backgroundReference)
        ? normalizeBackgroundFocus(stored.backgroundFocus) ?? focusFromLegacyCrop(stored.backgroundCrop) : null,
      backgroundFit:
        stored.backgroundFit === "cover" || stored.backgroundFit === "contain"
          ? stored.backgroundFit
          : defaultAppearancePreferences.backgroundFit,
      backgroundMask: numberInRange(
        stored.backgroundMask,
        35,
        90,
        defaultAppearancePreferences.backgroundMask,
      ),
      backgroundBlur: numberInRange(
        stored.backgroundBlur,
        0,
        32,
        defaultAppearancePreferences.backgroundBlur,
      ),
    };
  } catch {
    return { ...defaultAppearancePreferences };
  }
}

export function saveAppearancePreferences(
  storage: AppearanceStorage,
  preferences: AppearancePreferences,
): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(preferences));
}

export function resolveTheme(
  themeMode: ThemeMode,
  systemPrefersDark: boolean,
): ResolvedTheme {
  return themeMode === "system"
    ? systemPrefersDark
      ? "dark"
      : "light"
    : themeMode;
}

type Rgb = readonly [number, number, number];

const basePalette: Record<
  ResolvedTheme,
  { accent: Rgb; canvas: Rgb; panel: Rgb; text: Rgb }
> = {
  light: {
    accent: [96, 165, 250],
    canvas: [250, 250, 249],
    panel: [255, 255, 255],
    text: [28, 25, 23],
  },
  dark: {
    accent: [147, 197, 253],
    canvas: [12, 10, 9],
    panel: [28, 25, 23],
    text: [245, 245, 244],
  },
};

const customizableProperties = [
  "--color-canvas",
  "--color-panel",
  "--color-elevated",
  "--color-input",
  "--color-hover",
  "--color-border",
  "--color-border-strong",
  "--color-shadow",
  "--color-accent",
  "--color-accent-text",
  "--color-accent-hover",
  "--color-on-accent",
  "--color-user-message",
  "--color-user-message-text",
  "--color-focus",
  "--color-code-inline-text",
  "--color-assistant-bubble",
] as const;

function parseHexColor(color: string): Rgb {
  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16),
  ];
}

function mixColor(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((channel, index) =>
    Math.round(channel + (to[index] - channel) * amount),
  ) as unknown as Rgb;
}

function colorEquals(left: Rgb, right: Rgb): boolean {
  return left.every((channel, index) => channel === right[index]);
}

function luminance([red, green, blue]: Rgb): number {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.04045
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(left: Rgb, right: Rgb): number {
  const lighter = Math.max(luminance(left), luminance(right));
  const darker = Math.min(luminance(left), luminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function ensureContrast(
  color: Rgb,
  background: Rgb,
  minimumRatio: number,
  safeTarget: Rgb,
): Rgb {
  if (contrastRatio(color, background) >= minimumRatio) {
    return color;
  }
  for (let step = 1; step <= 100; step += 1) {
    const candidate = mixColor(color, safeTarget, step / 100);
    if (contrastRatio(candidate, background) >= minimumRatio) {
      return candidate;
    }
  }
  return safeTarget;
}

function rgbValue(color: Rgb): string {
  return color.join(" ");
}

function rgbHex(color: Rgb): string {
  return `#${color
    .map((channel) => channel.toString(16).padStart(2, "0"))
    .join("")}`;
}

function deriveAppearanceVariables(
  preferences: AppearancePreferences,
  resolvedTheme: ResolvedTheme,
): {
  variables: Map<string, string>;
  readabilityWarnings: string[];
  effectiveAccentColor: string;
  effectiveCanvasColor: string;
} {
  const base = basePalette[resolvedTheme];
  const variables = new Map<string, string>();
  const readabilityWarnings: string[] = [];
  let panel = base.panel;
  let effectiveCanvas = base.canvas;
  let effectiveAccent = base.accent;
  let effectiveUserText: Rgb = [15, 23, 42];

  if (preferences.assistantBubbleColor) {
    variables.set("--color-assistant-bubble", rgbValue(parseHexColor(preferences.assistantBubbleColor)));
  }

  if (preferences.canvasColor) {
    const requestedCanvas = parseHexColor(preferences.canvasColor);
    const canvas = ensureContrast(
      requestedCanvas,
      base.text,
      7,
      base.canvas,
    );
    effectiveCanvas = canvas;
    const towardSurface: Rgb = [255, 255, 255];
    panel = mixColor(canvas, towardSurface, resolvedTheme === "light" ? 0.42 : 0.08);
    const elevated = mixColor(
      canvas,
      resolvedTheme === "light" ? [0, 0, 0] : [255, 255, 255],
      resolvedTheme === "light" ? 0.035 : 0.14,
    );
    variables.set("--color-canvas", rgbValue(canvas));
    variables.set("--color-panel", rgbValue(panel));
    variables.set("--color-elevated", rgbValue(elevated));
    variables.set("--color-input", rgbValue(panel));
    variables.set("--color-hover", rgbValue(elevated));
    variables.set("--color-border", rgbValue(mixColor(canvas, base.text, 0.2)));
    variables.set(
      "--color-border-strong",
      rgbValue(mixColor(canvas, base.text, 0.38)),
    );
    variables.set("--color-shadow", rgbValue(base.text));
    if (!colorEquals(canvas, requestedCanvas)) {
      readabilityWarnings.push(
        "画布颜色已自动调整，以匹配当前基础主题的可读表面。",
      );
    }
  }

  if (preferences.accentColor) {
    const requestedAccent = parseHexColor(preferences.accentColor);
    const accent = ensureContrast(
      requestedAccent,
      panel,
      4.5,
      base.text,
    );
    effectiveAccent = accent;
    const accentHover = mixColor(accent, base.text, 0.14);
    const darkText: Rgb = [12, 10, 9];
    const lightText: Rgb = [255, 255, 255];
    const onAccent =
      contrastRatio(accent, darkText) >= contrastRatio(accent, lightText)
        ? darkText
        : lightText;
    effectiveUserText = onAccent;
    variables.set("--color-accent", rgbValue(accent));
    variables.set("--color-accent-text", rgbValue(accent));
    variables.set("--color-accent-hover", rgbValue(accentHover));
    variables.set("--color-on-accent", rgbValue(onAccent));
    variables.set("--color-user-message", rgbValue(accent));
    variables.set("--color-user-message-text", rgbValue(onAccent));
    variables.set("--color-focus", rgbValue(accent));
    variables.set("--color-code-inline-text", rgbValue(accentHover));
    if (!colorEquals(accent, requestedAccent)) {
      readabilityWarnings.unshift(
        "强调色已自动调整，以保持文字和控件清晰。",
      );
    }
  }

  // The blue user bubble can become darker than its original foreground as it
  // fades into a dark canvas. Preserve that foreground when readable, otherwise
  // choose black/white against the composited solid canvas. Arbitrary images
  // still require the user's background mask; we do not sample private images.
  const userBackground = mixColor(effectiveAccent, effectiveCanvas, preferences.assistantBubbleTransparency / 100);
  if (contrastRatio(effectiveUserText, userBackground) < 4.5) {
    const black: Rgb = [0, 0, 0];
    const white: Rgb = [255, 255, 255];
    variables.set("--color-user-message-text", rgbValue(contrastRatio(black, userBackground) >= contrastRatio(white, userBackground) ? black : white));
  }

  return {
    variables,
    readabilityWarnings,
    effectiveAccentColor: rgbHex(effectiveAccent),
    effectiveCanvasColor: rgbHex(effectiveCanvas),
  };
}

function applyAppearanceVariables(
  target: ThemeTarget,
  preferences: AppearancePreferences,
  resolvedTheme: ResolvedTheme,
): {
  readabilityWarnings: string[];
  effectiveAccentColor: string;
  effectiveCanvasColor: string;
} {
  const {
    variables,
    readabilityWarnings,
    effectiveAccentColor,
    effectiveCanvasColor,
  } = deriveAppearanceVariables(
    preferences,
    resolvedTheme,
  );
  customizableProperties.forEach((property) => {
    const value = variables.get(property);
    if (value === undefined) {
      target.style.removeProperty(property);
    } else {
      target.style.setProperty(property, value);
    }
  });
  target.style.setProperty("--sidebar-background-opacity", String(1 - preferences.sidebarTransparency / 100));
  target.style.setProperty("--composer-background-opacity", String(1 - preferences.composerTransparency / 100));
  target.style.setProperty("--message-bubble-opacity", String(1 - preferences.assistantBubbleTransparency / 100));
  return {
    readabilityWarnings,
    effectiveAccentColor,
    effectiveCanvasColor,
  };
}

interface BackgroundRuntimeState {
  backgroundUrl: string | null;
  backgroundStatus: BackgroundStatus;
  backgroundBusy: boolean;
  backgroundError: string | null;
  backgroundDraft: BackgroundDraft | null;
}

function initialBackgroundRuntime(
  preferences: AppearancePreferences,
): BackgroundRuntimeState {
  return {
    backgroundUrl: null,
    backgroundStatus: preferences.backgroundReference ? "loading" : "none",
    backgroundBusy: Boolean(preferences.backgroundReference),
    backgroundError: null,
    backgroundDraft: null,
  };
}

function applyBackgroundVariables(
  target: ThemeTarget,
  preferences: AppearancePreferences,
  runtime: BackgroundRuntimeState,
): void {
  target.style.setProperty(
    "--appearance-background-fit",
    preferences.backgroundFit,
  );
  target.style.setProperty(
    "--appearance-background-mask",
    String(preferences.backgroundMask / 100),
  );
  target.style.setProperty(
    "--appearance-background-blur",
    `${preferences.backgroundBlur}px`,
  );
  target.style.setProperty("--appearance-background-scale", String(1 + preferences.backgroundBlur / 100));
  if (runtime.backgroundUrl) {
    target.style.setProperty(
      "--appearance-background-image",
      `url(${JSON.stringify(runtime.backgroundUrl)})`,
    );
    target.setAttribute("data-has-background", "true");
  } else {
    target.style.removeProperty("--appearance-background-image");
    target.removeAttribute("data-has-background");
  }
}

export function applyResolvedTheme(
  target: ThemeTarget,
  resolvedTheme: ResolvedTheme,
): void {
  target.setAttribute("data-theme", resolvedTheme);
  target.style.colorScheme = resolvedTheme;
}

function createSnapshot(
  preferences: AppearancePreferences,
  resolvedTheme: ResolvedTheme,
  target: ThemeTarget,
  backgroundRuntime = initialBackgroundRuntime(preferences),
): AppearanceSnapshot {
  applyResolvedTheme(target, resolvedTheme);
  const {
    readabilityWarnings,
    effectiveAccentColor,
    effectiveCanvasColor,
  } = applyAppearanceVariables(
    target,
    preferences,
    resolvedTheme,
  );
  applyBackgroundVariables(target, preferences, backgroundRuntime);
  return {
    ...preferences,
    resolvedTheme,
    readabilityWarnings,
    effectiveAccentColor,
    effectiveCanvasColor,
    ...backgroundRuntime,
  };
}

export function applyInitialAppearance({
  storage,
  systemPrefersDark,
  target,
}: {
  storage: AppearanceStorage;
  systemPrefersDark: boolean;
  target: ThemeTarget;
}): AppearanceSnapshot {
  const preferences = loadAppearancePreferences(storage);
  return createSnapshot(
    preferences,
    resolveTheme(preferences.themeMode, systemPrefersDark),
    target,
  );
}

export function createAppearanceController({
  storage,
  systemTheme,
  target,
  backgroundResources,
}: {
  storage: AppearanceStorage;
  systemTheme: SystemThemeSource;
  target: ThemeTarget;
  backgroundResources?: BackgroundResourceStore;
}): AppearanceController {
  let snapshot = applyInitialAppearance({
    storage,
    systemPrefersDark: systemTheme.isDark(),
    target,
  });
  let preferences: AppearancePreferences = {
    themeMode: snapshot.themeMode,
    accentColor: snapshot.accentColor,
    canvasColor: snapshot.canvasColor,
    assistantBubbleColor: snapshot.assistantBubbleColor,
    unifiedTransparency: snapshot.unifiedTransparency,
    sidebarTransparency: snapshot.sidebarTransparency,
    composerTransparency: snapshot.composerTransparency,
    assistantBubbleTransparency: snapshot.assistantBubbleTransparency,
    backgroundReference: snapshot.backgroundReference,
    backgroundFocus: snapshot.backgroundFocus,
    backgroundFit: snapshot.backgroundFit,
    backgroundMask: snapshot.backgroundMask,
    backgroundBlur: snapshot.backgroundBlur,
  };
  let persistedBackgroundReference = preferences.backgroundReference;
  let backgroundRuntime: BackgroundRuntimeState = {
    backgroundUrl: snapshot.backgroundUrl,
    backgroundStatus: snapshot.backgroundStatus,
    backgroundBusy: snapshot.backgroundBusy,
    backgroundError: snapshot.backgroundError,
    backgroundDraft: null,
  };
  const listeners = new Set<() => void>();

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  function updatePreferences(next: AppearancePreferences): boolean {
    preferences = next;
    snapshot = createSnapshot(
      preferences,
      resolveTheme(preferences.themeMode, systemTheme.isDark()),
      target,
      backgroundRuntime,
    );
    let persisted = true;
    try {
      saveAppearancePreferences(storage, preferences);
      persistedBackgroundReference = preferences.backgroundReference;
    } catch {
      // Appearance changes remain usable if local storage is unavailable.
      persisted = false;
    }
    notify();
    return persisted;
  }

  function updateBackgroundRuntime(
    next: Partial<BackgroundRuntimeState>,
  ): void {
    backgroundRuntime = { ...backgroundRuntime, ...next };
    snapshot = createSnapshot(
      preferences,
      resolveTheme(preferences.themeMode, systemTheme.isDark()),
      target,
      backgroundRuntime,
    );
    notify();
  }

  const unsubscribeFromSystem = systemTheme.subscribe((prefersDark) => {
    if (preferences.themeMode !== "system") {
      return;
    }
    const resolvedTheme = resolveTheme(preferences.themeMode, prefersDark);
    if (resolvedTheme === snapshot.resolvedTheme) {
      return;
    }
    snapshot = createSnapshot(
      preferences,
      resolvedTheme,
      target,
      backgroundRuntime,
    );
    notify();
  });

  const ready = (async () => {
    const reference = preferences.backgroundReference;
    if (!backgroundResources) {
      if (reference) {
        updateBackgroundRuntime({
          backgroundStatus: "error",
          backgroundBusy: false,
          backgroundError: "已保存的背景不可用，已回退到基础主题。",
        });
      }
      return;
    }
    if (!reference) {
      updateBackgroundRuntime({ backgroundBusy: true });
      await backgroundResources.cleanup([]).catch(() => undefined);
      updateBackgroundRuntime({ backgroundBusy: false });
      return;
    }

    try {
      const resource = await backgroundResources.resolve(reference);
      if (preferences.backgroundReference !== reference) {
        return;
      }
      updateBackgroundRuntime({
        backgroundUrl: resource.url,
        backgroundStatus: "ready",
        backgroundBusy: true,
        backgroundError: null,
      });
      await backgroundResources.cleanup([reference]).catch(() => undefined);
      updateBackgroundRuntime({ backgroundBusy: false });
    } catch {
      if (preferences.backgroundReference !== reference) {
        return;
      }
      backgroundRuntime = {
        backgroundUrl: null,
        backgroundStatus: "error",
        backgroundBusy: true,
        backgroundError: "已保存的背景不可用，已回退到基础主题。",
        backgroundDraft: null,
      };
      const persisted = updatePreferences({
        ...preferences,
        backgroundReference: null,
        backgroundFocus: null,
      });
      await backgroundResources
        .cleanup(
          persisted || !persistedBackgroundReference
            ? []
            : [persistedBackgroundReference],
        )
        .catch(() => undefined);
      updateBackgroundRuntime({ backgroundBusy: false });
    }
  })();

  return {
    ready,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setThemeMode(themeMode) {
      if (themeMode !== preferences.themeMode) {
        updatePreferences({ ...preferences, themeMode });
      }
    },
    setAccentColor(color) {
      const normalized = color === null ? null : normalizeHexColor(color);
      if (normalized !== null || color === null) {
        updatePreferences({ ...preferences, accentColor: normalized });
      }
    },
    setCanvasColor(color) {
      const normalized = color === null ? null : normalizeHexColor(color);
      if (normalized !== null || color === null) {
        updatePreferences({ ...preferences, canvasColor: normalized });
      }
    },
    setAssistantBubbleColor(color) {
      const normalized = color === null ? null : normalizeHexColor(color);
      if (normalized !== null || color === null) {
        updatePreferences({ ...preferences, assistantBubbleColor: normalized });
      }
    },
    setUnifiedTransparency(transparency) {
      if (Number.isFinite(transparency)) {
        const value = Math.round(Math.min(100, Math.max(0, transparency)));
        updatePreferences({ ...preferences, unifiedTransparency: value, sidebarTransparency: value, composerTransparency: value, assistantBubbleTransparency: value });
      }
    },
    setSidebarTransparency(transparency) {
      if (Number.isFinite(transparency)) {
        const value = Math.round(Math.min(100, Math.max(0, transparency)));
        const next = { ...preferences, sidebarTransparency: value };
        updatePreferences(next.composerTransparency === value && next.assistantBubbleTransparency === value ? { ...next, unifiedTransparency: value } : next);
      }
    },
    setComposerTransparency(transparency) {
      if (Number.isFinite(transparency)) {
        const value = Math.round(Math.min(100, Math.max(0, transparency)));
        const next = { ...preferences, composerTransparency: value };
        updatePreferences(next.sidebarTransparency === value && next.assistantBubbleTransparency === value ? { ...next, unifiedTransparency: value } : next);
      }
    },
    setAssistantBubbleTransparency(transparency) {
      if (Number.isFinite(transparency)) {
        const value = Math.round(Math.min(100, Math.max(0, transparency)));
        const next = { ...preferences, assistantBubbleTransparency: value };
        updatePreferences(next.sidebarTransparency === value && next.composerTransparency === value ? { ...next, unifiedTransparency: value } : next);
      }
    },
    setBackgroundFit(fit) {
      if (fit === "cover" || fit === "contain") {
        updatePreferences({ ...preferences, backgroundFit: fit });
      }
    },
    setBackgroundMask(mask) {
      if (Number.isFinite(mask)) {
        updatePreferences({
          ...preferences,
          backgroundMask: Math.round(Math.min(90, Math.max(35, mask))),
        });
      }
    },
    setBackgroundBlur(blur) {
      if (Number.isFinite(blur)) {
        updatePreferences({
          ...preferences,
          backgroundBlur: Math.round(Math.min(32, Math.max(0, blur))),
        });
      }
    },
    async selectBackground() {
      if (!backgroundResources || backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) {
        return;
      }
      const previousRuntime = { ...backgroundRuntime };
      updateBackgroundRuntime({ backgroundBusy: true, backgroundError: null });
      try {
        const imported = await backgroundResources.selectAndImport();
        if (imported === null) {
          updateBackgroundRuntime({ backgroundBusy: false });
          return;
        }
        if (
          !isBackgroundReference(imported.reference) ||
          typeof imported.url !== "string" ||
          imported.url.length === 0
        ) {
          throw new BackgroundResourceError(
            "背景导入结果无效，现有背景未发生变化。",
          );
        }

        updateBackgroundRuntime({ backgroundDraft: { ...imported, focus: null }, backgroundBusy: false });
      } catch (error) {
        backgroundRuntime = previousRuntime;
        updateBackgroundRuntime({
          backgroundBusy: false,
          backgroundError:
            error instanceof BackgroundResourceError
              ? error.message
              : "无法导入背景图片，现有背景未发生变化。",
        });
      }
    },
    editBackgroundFocus() {
      if (backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft || !preferences.backgroundReference || !backgroundRuntime.backgroundUrl) return;
      updateBackgroundRuntime({
        backgroundDraft: { reference: preferences.backgroundReference, url: backgroundRuntime.backgroundUrl, focus: preferences.backgroundFocus },
        backgroundError: null,
      });
    },
    async confirmBackgroundFocus(focus) {
      const draft = backgroundRuntime.backgroundDraft;
      const normalized = normalizeBackgroundFocus(focus);
      if (!draft || !normalized || backgroundRuntime.backgroundBusy) return;
      backgroundRuntime = {
        backgroundUrl: draft.url, backgroundStatus: "ready", backgroundBusy: true,
        backgroundError: null, backgroundDraft: null,
      };
      const persisted = updatePreferences({ ...preferences, backgroundReference: draft.reference, backgroundFocus: normalized });
      try {
        await backgroundResources?.cleanup([...new Set([persistedBackgroundReference, draft.reference].filter((reference): reference is string => reference !== null))]);
      } catch {
        updateBackgroundRuntime({ backgroundError: "背景已更新，但旧的私有副本暂时无法清理。" });
      }
      if (!persisted) updateBackgroundRuntime({ backgroundError: "背景已预览，但本机偏好暂时无法保存。" });
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    async cancelBackgroundFocus() {
      if (!backgroundRuntime.backgroundDraft || backgroundRuntime.backgroundBusy) return;
      updateBackgroundRuntime({ backgroundDraft: null, backgroundBusy: true });
      try {
        await backgroundResources?.cleanup([...new Set([persistedBackgroundReference, preferences.backgroundReference].filter((reference): reference is string => reference !== null))]);
      } catch {
        updateBackgroundRuntime({ backgroundError: "已取消取景，但临时背景副本暂时无法清理。" });
      }
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    async removeBackground() {
      const previousReference = preferences.backgroundReference;
      if (!previousReference || backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) {
        return;
      }
      updateBackgroundRuntime({ backgroundBusy: true, backgroundError: null });
      backgroundRuntime = {
        backgroundUrl: null,
        backgroundStatus: "none",
        backgroundBusy: true,
        backgroundError: null,
        backgroundDraft: null,
      };
      const persisted = updatePreferences({
        ...preferences,
        backgroundReference: null,
        backgroundFocus: null,
      });
      if (backgroundResources) {
        try {
          await backgroundResources.cleanup(
            persisted || !persistedBackgroundReference
              ? []
              : [persistedBackgroundReference],
          );
        } catch {
          updateBackgroundRuntime({
            backgroundError: "背景已移除，但私有副本暂时无法清理。",
          });
        }
      }
      if (!persisted) {
        updateBackgroundRuntime({
          backgroundError: "背景已隐藏，但本机偏好暂时无法保存。",
        });
      }
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    async resetCustomAppearance() {
      if (backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) {
        return;
      }
      updateBackgroundRuntime({ backgroundBusy: true, backgroundError: null });
      backgroundRuntime = {
        backgroundUrl: null,
        backgroundStatus: "none",
        backgroundBusy: true,
        backgroundError: null,
        backgroundDraft: null,
      };
      const persisted = updatePreferences({
        ...defaultAppearancePreferences,
        themeMode: preferences.themeMode,
      });
      if (backgroundResources) {
        try {
          await backgroundResources.cleanup(
            persisted || !persistedBackgroundReference
              ? []
              : [persistedBackgroundReference],
          );
        } catch {
          updateBackgroundRuntime({
            backgroundError: "外观已重置，但私有背景副本暂时无法清理。",
          });
        }
      }
      if (!persisted) {
        updateBackgroundRuntime({
          backgroundError: "外观已重置，但本机偏好暂时无法保存。",
        });
      }
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    destroy() {
      unsubscribeFromSystem();
      listeners.clear();
    },
  };
}

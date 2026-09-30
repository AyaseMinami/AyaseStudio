import { focusFromLegacyCrop, normalizeBackgroundFocus, type BackgroundFocus } from "./backgroundFocus";
import { getColorPresetPalette, isColorPreset, type ColorPreset } from "./colorPresets";
export type { ColorPreset } from "./colorPresets";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = Exclude<ThemeMode, "system">;
export type BackgroundFit = "cover" | "contain";

export interface BackgroundLibraryEntry {
  id: string;
  name: string;
  reference: string;
  focus: BackgroundFocus | null;
  fit: BackgroundFit;
  mask: number;
  blur: number;
}

export type BackgroundLibraryEdit = Pick<BackgroundLibraryEntry, "reference" | "focus" | "fit" | "mask" | "blur">;

export interface AppearancePreferences {
  colorPreset: ColorPreset;
  themeMode: ThemeMode;
  accentColor: string | null;
  userBubbleColor: string | null;
  unifiedThemeColor: string | null;
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
  backgroundLibrary: BackgroundLibraryEntry[];
  backgroundEnabled: boolean;
  backgroundName: string | null;
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
  name?: string;
}

export interface BackgroundDraft extends BackgroundResource {
  focus: BackgroundFocus | null;
}

export interface BackgroundResourceStore {
  selectAndImport(): Promise<BackgroundResource | null>;
  resolve(reference: string, options?: { thumbnail?: boolean; refresh?: boolean }): Promise<BackgroundResource>;
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
  effectiveUserBubbleColor: string;
  effectiveCanvasColor: string;
  readabilityWarnings: string[];
  backgroundUrl: string | null;
  backgroundStatus: BackgroundStatus;
  backgroundBusy: boolean;
  backgroundError: string | null;
  backgroundDraft: BackgroundDraft | null;
}

export interface AppearanceController {
  setColorPreset(preset: ColorPreset): void;
  ready: Promise<void>;
  getSnapshot(): AppearanceSnapshot;
  subscribe(listener: () => void): () => void;
  setThemeMode(themeMode: ThemeMode): void;
  setAccentColor(color: string | null): void;
  setUserBubbleColor(color: string | null): void;
  setUnifiedThemeColor(color: string | null): void;
  setCanvasColor(color: string | null): void;
  setAssistantBubbleColor(color: string | null): void;
  setUnifiedTransparency(transparency: number | null): void;
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
  prepareLibraryBackground(): Promise<BackgroundResource | null>;
  saveLibraryBackground(resource: BackgroundResource, replaceId?: string): Promise<BackgroundLibraryEntry>;
  discardLibraryBackground(reference: string): Promise<void>;
  resolveLibraryBackground(reference: string, options?: { thumbnail?: boolean; refresh?: boolean }): Promise<BackgroundResource>;
  applyLibraryBackground(id: string, edit?: BackgroundLibraryEdit): Promise<void>;
  removeLibraryBackgrounds(ids: string[]): Promise<void>;
  restoreBackground(): Promise<void>;
  destroy(): void;
}

export const APPEARANCE_STORAGE_KEY = "ayase-studio.appearance.v1";

export const defaultAppearancePreferences: Readonly<AppearancePreferences> = {
  colorPreset: "default",
  themeMode: "system",
  accentColor: null,
  userBubbleColor: null,
  unifiedThemeColor: null,
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
  backgroundLibrary: [],
  backgroundEnabled: true,
  backgroundName: null,
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
      colorPreset: isColorPreset(stored.colorPreset) ? stored.colorPreset : "default",
      themeMode:
        stored.themeMode === "light" ||
        stored.themeMode === "dark" ||
        stored.themeMode === "system"
          ? stored.themeMode
          : defaultAppearancePreferences.themeMode,
      accentColor: normalizeHexColor(stored.accentColor),
      userBubbleColor: stored.userBubbleColor === undefined ? normalizeHexColor(stored.accentColor) : normalizeHexColor(stored.userBubbleColor),
      unifiedThemeColor: normalizeHexColor(stored.unifiedThemeColor),
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
      backgroundEnabled: stored.backgroundEnabled !== false,
      backgroundName: typeof stored.backgroundName === "string" ? stored.backgroundName.slice(0, 100) : null,
      backgroundLibrary: normalizeBackgroundLibrary(stored),
    };
  } catch {
    return { ...defaultAppearancePreferences };
  }
}

function normalizeBackgroundLibrary(stored: Partial<AppearancePreferences> & { backgroundCrop?: unknown }): BackgroundLibraryEntry[] {
  // An absent field is the pre-library format. Preserve its original file and every display parameter.
  if (stored.backgroundLibrary === undefined && isBackgroundReference(stored.backgroundReference)) {
    return [{ id: stored.backgroundReference, name: "原有背景", reference: stored.backgroundReference,
      focus: normalizeBackgroundFocus(stored.backgroundFocus) ?? focusFromLegacyCrop(stored.backgroundCrop),
      fit: stored.backgroundFit === "contain" ? "contain" : "cover",
      mask: numberInRange(stored.backgroundMask, 35, 90, 65), blur: numberInRange(stored.backgroundBlur, 0, 32, 0) }];
  }
  if (!Array.isArray(stored.backgroundLibrary)) return [];
  const ids = new Set<string>();
  return stored.backgroundLibrary.flatMap((entry) => {
    if (!entry || typeof entry.id !== "string" || !entry.id || ids.has(entry.id) || !isBackgroundReference(entry.reference)) return [];
    ids.add(entry.id);
    return [{ id: entry.id, reference: entry.reference,
      name: typeof entry.name === "string" && entry.name.trim() ? entry.name.trim().slice(0, 100) : "背景",
      focus: normalizeBackgroundFocus(entry.focus), fit: entry.fit === "contain" ? "contain" as const : "cover" as const,
      mask: numberInRange(entry.mask, 35, 90, 65), blur: numberInRange(entry.blur, 0, 32, 0) }];
  });
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
    accent: [37, 99, 235],
    canvas: [250, 250, 250],
    panel: [255, 255, 255],
    text: [41, 42, 45],
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

function userBubbleColorFor(preferences: AppearancePreferences, theme: ResolvedTheme): string {
  return preferences.userBubbleColor ?? getColorPresetPalette(preferences.colorPreset, theme).userBubble;
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
  const preset = getColorPresetPalette(preferences.colorPreset, resolvedTheme);
  const base = { ...basePalette[resolvedTheme], canvas: parseHexColor(preset.canvas), accent: parseHexColor(preset.accent) };
  const variables = new Map<string, string>();
  const readabilityWarnings: string[] = [];
  let panel = base.panel;
  let effectiveCanvas = base.canvas;
  let effectiveAccent = base.accent;
  const effectiveUserBackground = parseHexColor(userBubbleColorFor(preferences, resolvedTheme));
  let effectiveUserText: Rgb = resolvedTheme === "light" ? [41, 42, 45] : [15, 23, 42];

  if (preferences.colorPreset !== "default") {
    variables.set("--color-canvas", rgbValue(base.canvas));
    variables.set("--color-user-message", rgbValue(effectiveUserBackground));
    variables.set("--color-assistant-bubble", rgbValue(parseHexColor(preset.assistantBubble)));
  }

  if (preferences.assistantBubbleColor) {
    variables.set("--color-assistant-bubble", rgbValue(parseHexColor(preferences.assistantBubbleColor)));
  }

  if (preferences.userBubbleColor) {
    variables.set("--color-user-message", rgbValue(effectiveUserBackground));
  }

  if (preferences.canvasColor || preferences.colorPreset !== "default") {
    const requestedCanvas = parseHexColor(preferences.canvasColor ?? preset.canvas);
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

  if (preferences.accentColor || preferences.colorPreset !== "default") {
    const requestedAccent = parseHexColor(preferences.accentColor ?? preset.accent);
    const accentText = ensureContrast(
      requestedAccent,
      panel,
      4.5,
      base.text,
    );
    const accent = requestedAccent;
    effectiveAccent = accent;
    const accentHover = mixColor(accent, base.text, 0.14);
    const darkText: Rgb = [12, 10, 9];
    const lightText: Rgb = [255, 255, 255];
    const onAccent =
      contrastRatio(accent, darkText) >= contrastRatio(accent, lightText)
        ? darkText
        : lightText;
    variables.set("--color-accent", rgbValue(accent));
    variables.set("--color-accent-text", rgbValue(accentText));
    variables.set("--color-accent-hover", rgbValue(accentHover));
    variables.set("--color-on-accent", rgbValue(onAccent));
    variables.set("--color-focus", rgbValue(accentText));
    variables.set("--color-code-inline-text", rgbValue(accentText));
  }

  // The blue user bubble can become darker than its original foreground as it
  // fades into a dark canvas. Preserve that foreground when readable, otherwise
  // choose black/white against the composited solid canvas. Arbitrary images
  // still require the user's background mask; we do not sample private images.
  const userBackground = mixColor(effectiveUserBackground, effectiveCanvas, preferences.assistantBubbleTransparency / 100);
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
    backgroundStatus: preferences.backgroundReference && preferences.backgroundEnabled ? "loading" : "none",
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
    effectiveUserBubbleColor: userBubbleColorFor(preferences, resolvedTheme),
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
    colorPreset: snapshot.colorPreset,
    themeMode: snapshot.themeMode,
    accentColor: snapshot.accentColor,
    userBubbleColor: snapshot.userBubbleColor,
    unifiedThemeColor: snapshot.unifiedThemeColor,
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
    backgroundLibrary: snapshot.backgroundLibrary,
    backgroundEnabled: snapshot.backgroundEnabled,
    backgroundName: snapshot.backgroundName ?? (snapshot.backgroundReference ? "原有背景" : null),
  };
  let persistedReferences = retainedReferences(preferences);
  const pendingResources = new Map<string, BackgroundResource>();
  // Immutable file references let previews share validation and asset URLs for this session.
  // Keep promises too so simultaneous thumbnails do not decode the same file twice.
  const previewResources = new Map<string, Promise<BackgroundResource>>();
  const thumbnailResources = new Map<string, Promise<BackgroundResource>>();
  function resolveBackgroundResource(reference: string, refresh = false, thumbnail = false): Promise<BackgroundResource> {
    if (!backgroundResources || !isBackgroundReference(reference)) return Promise.reject(new BackgroundResourceError("背景资源不可用。"));
    const cache = thumbnail ? thumbnailResources : previewResources;
    const cached = cache.get(reference);
    if (cached && !refresh) return cached;
    const pending = Promise.resolve().then(() => backgroundResources.resolve(reference, { thumbnail, refresh })).catch((error: unknown) => {
      if (cache.get(reference) === pending) cache.delete(reference);
      throw error;
    });
    cache.set(reference, pending);
    return pending;
  }
  // A malformed/unreadable metadata record must never authorize deletion of its files.
  let cleanupSafe = true;
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY);
    const stored = raw === null ? null : JSON.parse(raw);
    cleanupSafe = raw === null || (!!stored && typeof stored === "object" && !Array.isArray(stored));
    if (stored?.backgroundLibrary !== undefined) {
      cleanupSafe = cleanupSafe && Array.isArray(stored.backgroundLibrary)
        && stored.backgroundLibrary.length === preferences.backgroundLibrary.length;
    }
    if (stored?.backgroundReference && !isBackgroundReference(stored.backgroundReference)) cleanupSafe = false;
  } catch { cleanupSafe = false; }
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

  function retainedReferences(value: AppearancePreferences): string[] {
    return [...new Set([value.backgroundReference, ...value.backgroundLibrary.map((entry) => entry.reference)]
      .filter((reference): reference is string => reference !== null))];
  }

  async function cleanup(): Promise<void> {
    if (!cleanupSafe) return;
    const draft = backgroundRuntime.backgroundDraft?.reference;
    const retained = new Set([...persistedReferences, ...retainedReferences(preferences),
      ...pendingResources.keys(), ...(draft ? [draft] : [])]);
    for (const reference of previewResources.keys()) if (!retained.has(reference)) previewResources.delete(reference);
    for (const reference of thumbnailResources.keys()) if (!retained.has(reference)) thumbnailResources.delete(reference);
    await backgroundResources?.cleanup([...retained]);
  }

  function updatePreferences(next: AppearancePreferences, requireSave = false): boolean {
    let persisted = true;
    try {
      saveAppearancePreferences(storage, next);
      persistedReferences = retainedReferences(next);
    } catch {
      if (requireSave) throw new BackgroundResourceError("无法保存背景设置，原图片和配置保持不变，请重试。");
      persisted = false;
    }
    preferences = next;
    snapshot = createSnapshot(
      preferences,
      resolveTheme(preferences.themeMode, systemTheme.isDark()),
      target,
      backgroundRuntime,
    );
    notify();
    return persisted;
  }

  function backgroundPreferences(patch: Partial<AppearancePreferences>): AppearancePreferences {
    const next = { ...preferences, ...patch };
    // Only the same immutable image version receives current display edits. A replacement or
    // deleted library entry must never receive edits intended for the independently held old image.
    next.backgroundLibrary = next.backgroundLibrary.map((entry) => entry.reference === next.backgroundReference
      ? { ...entry, focus: next.backgroundFocus, fit: next.backgroundFit, mask: next.backgroundMask, blur: next.backgroundBlur }
      : entry);
    return next;
  }

  function updateBackgroundPreferences(patch: Partial<AppearancePreferences>): void {
    if (backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) return;
    try {
      updatePreferences(backgroundPreferences(patch), true);
      updateBackgroundRuntime({ backgroundError: null });
    } catch (error) { updateBackgroundRuntime({ backgroundError: (error as Error).message }); }
  }

  async function backgroundOperation<T>(action: () => Promise<T>): Promise<T> {
    if (backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) throw new BackgroundResourceError("背景正在处理中，请稍后重试。");
    updateBackgroundRuntime({ backgroundBusy: true, backgroundError: null });
    try { return await action(); }
    finally { updateBackgroundRuntime({ backgroundBusy: false }); }
  }

  async function cleanupAfterSave(): Promise<void> {
    try { await cleanup(); }
    catch { updateBackgroundRuntime({ backgroundError: "更改已保存，未使用的私有图片暂时无法清理，将在下次启动时重试。" }); }
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
    if (!reference || !preferences.backgroundEnabled) {
      updateBackgroundRuntime({ backgroundBusy: true });
      await cleanupAfterSave();
      updateBackgroundRuntime({ backgroundBusy: false });
      return;
    }

    try {
      const resource = await resolveBackgroundResource(reference, true);
      if (preferences.backgroundReference !== reference) {
        return;
      }
      updateBackgroundRuntime({
        backgroundUrl: resource.url,
        backgroundStatus: "ready",
        backgroundBusy: true,
        backgroundError: null,
      });
      await cleanupAfterSave();
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
      // Keep unavailable resources and parameters for recovery or explicit removal.
      updateBackgroundRuntime({ backgroundBusy: false });
    }
  })();

  return {
    ready,
    setColorPreset(colorPreset) {
      updatePreferences({ ...preferences, colorPreset, accentColor: null, userBubbleColor: null, unifiedThemeColor: null, canvasColor: null, assistantBubbleColor: null });
    },
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
        const next = { ...preferences, accentColor: normalized };
        const component = normalized ?? getColorPresetPalette(preferences.colorPreset, snapshot.resolvedTheme).accent;
        updatePreferences(component === userBubbleColorFor(next, snapshot.resolvedTheme) ? { ...next, unifiedThemeColor: component } : next);
      }
    },
    setUserBubbleColor(color) {
      const normalized = color === null ? null : normalizeHexColor(color);
      if (normalized !== null || color === null) {
        const next = { ...preferences, userBubbleColor: normalized };
        updatePreferences(userBubbleColorFor(next, snapshot.resolvedTheme) === snapshot.effectiveAccentColor ? { ...next, unifiedThemeColor: snapshot.effectiveAccentColor } : next);
      }
    },
    setUnifiedThemeColor(color) {
      if (color === null) {
        updatePreferences({ ...preferences, unifiedThemeColor: null, accentColor: null, userBubbleColor: null });
        return;
      }
      const normalized = normalizeHexColor(color);
      if (normalized) updatePreferences({ ...preferences, unifiedThemeColor: normalized, accentColor: normalized, userBubbleColor: normalized });
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
      if (transparency === null) {
        const { unifiedTransparency, sidebarTransparency, composerTransparency, assistantBubbleTransparency } = defaultAppearancePreferences;
        updatePreferences({ ...preferences, unifiedTransparency, sidebarTransparency, composerTransparency, assistantBubbleTransparency });
        return;
      }
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
        updateBackgroundPreferences({ backgroundFit: fit });
      }
    },
    setBackgroundMask(mask) {
      if (Number.isFinite(mask)) {
        updateBackgroundPreferences({
          backgroundMask: Math.round(Math.min(90, Math.max(35, mask))),
        });
      }
    },
    setBackgroundBlur(blur) {
      if (Number.isFinite(blur)) {
        updateBackgroundPreferences({
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
      updateBackgroundRuntime({ backgroundBusy: true });
      try {
        let next = backgroundPreferences({ backgroundReference: draft.reference, backgroundFocus: normalized, backgroundEnabled: true });
        if (draft.reference !== preferences.backgroundReference) {
          const entry: BackgroundLibraryEntry = { id: draft.reference, name: draft.name || "背景", reference: draft.reference,
            focus: normalized, fit: next.backgroundFit, mask: next.backgroundMask, blur: next.backgroundBlur };
          next = { ...next, backgroundName: entry.name, backgroundLibrary: [...next.backgroundLibrary, entry] };
        }
        updatePreferences(next, true);
        updateBackgroundRuntime({ backgroundUrl: draft.url, backgroundStatus: "ready", backgroundError: null, backgroundDraft: null });
        await cleanupAfterSave();
      } catch (error) {
        updateBackgroundRuntime({ backgroundError: (error as Error).message });
      }
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    async cancelBackgroundFocus() {
      if (!backgroundRuntime.backgroundDraft || backgroundRuntime.backgroundBusy) return;
      updateBackgroundRuntime({ backgroundDraft: null, backgroundBusy: true });
      await cleanupAfterSave();
      updateBackgroundRuntime({ backgroundBusy: false });
    },
    async removeBackground() {
      if (!preferences.backgroundReference || backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) return;
      try {
        await backgroundOperation(async () => {
          updatePreferences({ ...preferences, backgroundEnabled: false }, true);
          updateBackgroundRuntime({ backgroundUrl: null, backgroundStatus: "none" });
        });
      } catch (error) { updateBackgroundRuntime({ backgroundError: (error as Error).message }); }
    },
    async resetCustomAppearance() {
      if (backgroundRuntime.backgroundBusy || backgroundRuntime.backgroundDraft) return;
      try {
        await backgroundOperation(async () => {
          updatePreferences({ ...defaultAppearancePreferences, themeMode: preferences.themeMode,
            backgroundLibrary: preferences.backgroundLibrary, backgroundReference: preferences.backgroundReference,
            backgroundName: preferences.backgroundName, backgroundFocus: preferences.backgroundFocus,
            backgroundFit: preferences.backgroundFit, backgroundMask: preferences.backgroundMask,
            backgroundBlur: preferences.backgroundBlur, backgroundEnabled: false }, true);
          updateBackgroundRuntime({ backgroundUrl: null, backgroundStatus: "none" });
        });
      } catch (error) { updateBackgroundRuntime({ backgroundError: (error as Error).message }); }
    },
    async prepareLibraryBackground() {
      return backgroundOperation(async () => {
        if (!backgroundResources) throw new BackgroundResourceError("当前环境无法导入本地背景。");
        const resource = await backgroundResources.selectAndImport();
        if (!resource) return null;
        if (!isBackgroundReference(resource.reference) || !resource.url) throw new BackgroundResourceError("背景导入结果无效。");
        pendingResources.set(resource.reference, resource);
        return resource;
      });
    },
    async saveLibraryBackground(resource, replaceId) {
      return backgroundOperation(async () => {
        const pending = pendingResources.get(resource.reference);
        if (!pending) throw new BackgroundResourceError("导入草稿已失效，请重新导入。");
        const previous = replaceId ? preferences.backgroundLibrary.find((entry) => entry.id === replaceId) : undefined;
        if (replaceId && !previous) throw new BackgroundResourceError("这张背景已不在库中，请重新选择。");
        const entry: BackgroundLibraryEntry = { id: previous?.id ?? resource.reference,
          name: previous?.name ?? (pending.name?.trim().slice(0, 100) || "背景"),
          reference: pending.reference, focus: null, fit: previous?.fit ?? "cover", mask: previous?.mask ?? 65, blur: previous?.blur ?? 0 };
        const backgroundLibrary = previous ? preferences.backgroundLibrary.map((item) => item.id === previous.id ? entry : item)
          : [...preferences.backgroundLibrary, entry];
        updatePreferences({ ...preferences, backgroundLibrary }, true);
        pendingResources.delete(resource.reference);
        await cleanupAfterSave();
        return entry;
      });
    },
    async discardLibraryBackground(reference) {
      await backgroundOperation(async () => { pendingResources.delete(reference); await cleanupAfterSave(); });
    },
    async resolveLibraryBackground(reference, options) {
      return resolveBackgroundResource(reference, options?.refresh, options?.thumbnail);
    },
    async applyLibraryBackground(id, edit) {
      await backgroundOperation(async () => {
        const entry = preferences.backgroundLibrary.find((item) => item.id === id);
        if (!entry || !backgroundResources) throw new BackgroundResourceError("这张背景已不在库中，请重新选择。");
        if (edit && edit.reference !== entry.reference) throw new BackgroundResourceError("这张背景已被替换，请重新选择后调整。");
        const focus = edit?.focus === null ? null : normalizeBackgroundFocus(edit?.focus);
        if (edit && ((edit.focus !== null && !focus) || !["cover", "contain"].includes(edit.fit)
          || !Number.isFinite(edit.mask) || edit.mask < 35 || edit.mask > 90
          || !Number.isFinite(edit.blur) || edit.blur < 0 || edit.blur > 32)) {
          throw new BackgroundResourceError("背景参数无效，请重新调整。");
        }
        const applied = edit ? { ...entry, focus, fit: edit.fit, mask: Math.round(edit.mask), blur: Math.round(edit.blur) } : entry;
        const resource = await resolveBackgroundResource(entry.reference, true);
        updatePreferences({ ...preferences, backgroundReference: entry.reference, backgroundName: entry.name,
          backgroundEnabled: true, backgroundFocus: applied.focus, backgroundFit: applied.fit,
          backgroundMask: applied.mask, backgroundBlur: applied.blur,
          backgroundLibrary: preferences.backgroundLibrary.map((item) => item.id === id ? applied : item) }, true);
        updateBackgroundRuntime({ backgroundUrl: resource.url, backgroundStatus: "ready" });
        await cleanupAfterSave();
      });
    },
    async removeLibraryBackgrounds(ids) {
      await backgroundOperation(async () => {
        const selected = new Set(ids);
        if (!selected.size) return;
        if ([...selected].some((id) => !preferences.backgroundLibrary.some((entry) => entry.id === id))) {
          throw new BackgroundResourceError("部分背景已不在库中，请重新选择。");
        }
        updatePreferences({ ...preferences, backgroundLibrary: preferences.backgroundLibrary.filter((entry) => !selected.has(entry.id)) }, true);
        await cleanupAfterSave();
      });
    },
    async restoreBackground() {
      try {
        await backgroundOperation(async () => {
          if (!preferences.backgroundReference || !backgroundResources) return;
          const resource = await resolveBackgroundResource(preferences.backgroundReference, true);
          updatePreferences({ ...preferences, backgroundEnabled: true }, true);
          updateBackgroundRuntime({ backgroundUrl: resource.url, backgroundStatus: "ready" });
        });
      } catch (error) { updateBackgroundRuntime({ backgroundError: (error as Error).message }); }
    },
    destroy() {
      previewResources.clear();
      thumbnailResources.clear();
      unsubscribeFromSystem();
      listeners.clear();
    },
  };
}

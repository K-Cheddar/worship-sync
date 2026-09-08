import { app, screen, BrowserWindow } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";
import {
  findDisplayByBounds,
  findDisplayById,
  pickFallbackDisplay,
} from "./windowDisplayMatch";

/**
 * Key identifying a display window. The three original surfaces keep the keys
 * "projector", "monitor", and "board"; windows opened for a display output use
 * that output's id, so a church can run as many as it has screens.
 */
export type WindowType = string;

/** Windows that predate display outputs and are always available. */
export const BUILT_IN_WINDOW_KEYS = ["projector", "monitor", "board"] as const;

export interface SavedDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  /**
   * Render profile this window was opened with. Persisted so a window for a
   * display output can be rebuilt on launch, when the main process has no
   * access to the church registry.
   */
  surface?: string;
  displayId?: number;
  /** Saved display bounds for matching after reboot (display IDs can change on Windows) */
  displayBounds?: SavedDisplayBounds;
  wasOpen?: boolean; // Track if window was open when app closed
}

export interface MainWindowState {
  bounds?: SavedDisplayBounds;
  isMaximized?: boolean;
}

export interface WindowStates {
  /** Per-window state, keyed by window key. */
  displays: Record<string, WindowState>;
  main?: MainWindowState;
}

// Default window states
const DEFAULT_WINDOW_STATES: WindowStates = { displays: {} };

/**
 * Older builds stored each window at the top level (`{ projector: {...} }`).
 * Fold those into `displays` so an existing install keeps its screen
 * assignments instead of reopening every window on the primary display.
 */
const migrateStates = (raw: Record<string, unknown>): WindowStates => {
  if (raw.displays && typeof raw.displays === "object") {
    return {
      displays: (raw.displays as Record<string, WindowState>) ?? {},
      main: raw.main as MainWindowState | undefined,
    };
  }
  const displays: Record<string, WindowState> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "main" || !value || typeof value !== "object") continue;
    displays[key] = value as WindowState;
  }
  return { displays, main: raw.main as MainWindowState | undefined };
};

export class WindowStateManager {
  private stateFilePath: string;
  private states: WindowStates;

  constructor() {
    this.stateFilePath = join(app.getPath("userData"), "window-states.json");
    this.states = this.loadStates();
  }

  private loadStates(): WindowStates {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, "utf-8");
        return migrateStates(JSON.parse(data) as Record<string, unknown>);
      }
    } catch (error) {
      console.error("Error loading window states:", error);
    }
    return { ...DEFAULT_WINDOW_STATES };
  }

  private saveStates(): void {
    try {
      fs.writeFileSync(
        this.stateFilePath,
        JSON.stringify(this.states, null, 2),
        "utf-8",
      );
    } catch (error) {
      console.error("Error saving window states:", error);
    }
  }

  /** Every window key with saved state, including display output windows. */
  listKeys(): string[] {
    return Object.keys(this.states.displays);
  }

  /** Remember the render profile so the window can be recreated on launch. */
  rememberSurface(windowType: WindowType, surface?: string): void {
    if (!surface) return;
    const existing = this.states.displays[windowType] ?? {};
    if (existing.surface === surface) return;
    this.states.displays[windowType] = { ...existing, surface };
    this.saveStates();
  }

  getState(windowType: WindowType): WindowState {
    return this.states.displays[windowType] ?? {};
  }

  saveWindowState(windowType: WindowType, window: BrowserWindow): void {
    // Since windows are always fullscreen, just detect which display they're on
    const bounds = window.getBounds();
    const detectedDisplay = screen.getDisplayMatching(bounds);
    const b = detectedDisplay.bounds;

    this.states.displays[windowType] = {
      // Keep the render profile: it is what rebuilds the route on next launch,
      // and a save on move or ready-to-show must not drop it.
      ...this.states.displays[windowType],
      displayId: detectedDisplay.id,
      displayBounds: { x: b.x, y: b.y, width: b.width, height: b.height },
      wasOpen: true,
    };

    this.saveStates();
  }

  /**
   * Mark a window as closed
   */
  markWindowClosed(windowType: WindowType) {
    if (!this.states.displays[windowType]) return;
    this.states.displays[windowType].wasOpen = false;
    this.saveStates();
  }

  /**
   * Check if window was open when app last closed
   */
  wasWindowOpen(windowType: WindowType): boolean {
    return this.states.displays[windowType]?.wasOpen ?? false;
  }

  /**
   * Get the best display for a window based on saved state.
   * Uses displayId first; if not found (e.g. IDs changed after reboot), matches by saved bounds.
   */
  getDisplayForWindow(windowType: WindowType) {
    const state = this.getState(windowType);
    const displays = screen.getAllDisplays();

    const byId = findDisplayById(displays, state.displayId);
    if (byId) return byId;

    const byBounds = findDisplayByBounds(displays, state.displayBounds);
    if (byBounds) return byBounds;

    return pickFallbackDisplay(
      displays,
      windowType,
      screen.getPrimaryDisplay(),
    );
  }

  /**
   * Get window bounds for a specific display (always fullscreen)
   */
  getWindowBounds(display: Electron.Display): {
    x: number;
    y: number;
    width: number;
    height: number;
  } {
    // Windows are always fullscreen, so just use the display's bounds
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    };
  }

  /**
   * Set display preference for a window (also saves bounds for stable matching after reboot)
   */
  setDisplayPreference(windowType: WindowType, displayId: number): void {
    if (!this.states.displays[windowType]) {
      this.states.displays[windowType] = {};
    }
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    const b = display?.bounds;
    this.states.displays[windowType].displayId = displayId;
    this.states.displays[windowType].displayBounds = b
      ? { x: b.x, y: b.y, width: b.width, height: b.height }
      : undefined;
    this.saveStates();
  }

  getMainWindowState(): MainWindowState | undefined {
    return this.states.main;
  }

  saveMainWindowState(window: BrowserWindow): void {
    const bounds = window.getBounds();
    this.states.main = {
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      isMaximized: window.isMaximized(),
    };
    this.saveStates();
  }

  /**
   * Returns bounds for the main window: restored from state if valid on current displays,
   * otherwise undefined (caller should use defaults).
   */
  getMainWindowBounds(): SavedDisplayBounds | undefined {
    const main = this.states.main?.bounds;
    if (!main || main.width <= 0 || main.height <= 0) return undefined;

    const displays = screen.getAllDisplays();
    const displayContainingCenter = screen.getDisplayMatching({
      x: main.x + main.width / 2,
      y: main.y + main.height / 2,
      width: 1,
      height: 1,
    });
    const onCurrentDisplay = displays.some(
      (d) => d.id === displayContainingCenter.id,
    );
    if (onCurrentDisplay) return main;

    const primary = screen.getPrimaryDisplay().bounds;
    return { ...main, x: primary.x, y: primary.y };
  }

  wasMainWindowMaximized(): boolean {
    return this.states.main?.isMaximized ?? false;
  }
}

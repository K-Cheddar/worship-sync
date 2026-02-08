import { app, screen, BrowserWindow } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";

export type WindowType = "projector" | "monitor";

export interface SavedDisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowState {
  displayId?: number;
  /** Saved display bounds for matching after reboot (display IDs can change on Windows) */
  displayBounds?: SavedDisplayBounds;
  wasOpen?: boolean; // Track if window was open when app closed
}

export interface WindowStates {
  projector: WindowState;
  monitor: WindowState;
}

// Default window states
const DEFAULT_WINDOW_STATES: WindowStates = {
  projector: {},
  monitor: {},
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
        return { ...DEFAULT_WINDOW_STATES, ...JSON.parse(data) };
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
        "utf-8"
      );
    } catch (error) {
      console.error("Error saving window states:", error);
    }
  }

  getState(windowType: WindowType): WindowState {
    return this.states[windowType];
  }

  saveWindowState(
    windowType: WindowType,
    window: BrowserWindow
  ): void {
    // Since windows are always fullscreen, just detect which display they're on
    const bounds = window.getBounds();
    const detectedDisplay = screen.getDisplayMatching(bounds);
    const b = detectedDisplay.bounds;

    this.states[windowType] = {
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
    this.states[windowType].wasOpen = false;
    this.saveStates();
  }

  /**
   * Check if window was open when app last closed
   */
  wasWindowOpen(windowType: WindowType): boolean {
    return this.states[windowType].wasOpen ?? false;
  }

  /**
   * Get the best display for a window based on saved state.
   * Uses displayId first; if not found (e.g. IDs changed after reboot), matches by saved bounds.
   */
  getDisplayForWindow(windowType: WindowType) {
    const state = this.states[windowType];
    const displays = screen.getAllDisplays();

    // 1. Try saved display ID (works when IDs are stable)
    if (state.displayId !== undefined && state.displayId !== null) {
      const byId = displays.find((d) => d.id === state.displayId);
      if (byId) return byId;
    }

    // 2. After reboot, display IDs often change on Windows. Match by saved bounds so the same
    //    physical screen is used (position + size is stable for a given layout).
    if (state.displayBounds) {
      const { x, y, width, height } = state.displayBounds;
      const byBounds = displays.find((d) => {
        const b = d.bounds;
        return b.x === x && b.y === y && b.width === width && b.height === height;
      });
      if (byBounds) return byBounds;
    }

    // 3. Fallback: assign by index (projector = second, monitor = third or second)
    if (displays.length > 1) {
      if (windowType === "projector") return displays[1];
      if (windowType === "monitor") return displays.length > 2 ? displays[2] : displays[1];
    }

    return screen.getPrimaryDisplay();
  }

  /**
   * Get window bounds for a specific display (always fullscreen)
   */
  getWindowBounds(display: Electron.Display): { x: number; y: number; width: number; height: number } {
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
    if (!this.states[windowType]) {
      this.states[windowType] = {};
    }
    const display = screen.getAllDisplays().find((d) => d.id === displayId);
    const b = display?.bounds;
    this.states[windowType].displayId = displayId;
    this.states[windowType].displayBounds = b
      ? { x: b.x, y: b.y, width: b.width, height: b.height }
      : undefined;
    this.saveStates();
  }
}

import { app, screen, BrowserWindow } from "electron";
import { join } from "node:path";
import * as fs from "node:fs";

export interface WindowState {
  displayId?: number;
  x?: number;
  y?: number;
  width: number;
  height: number;
  isFullScreen: boolean;
}

export interface WindowStates {
  projector: WindowState;
  monitor: WindowState;
}

// Default window states - both windows are always fullscreen
const DEFAULT_WINDOW_STATES: WindowStates = {
  projector: {
    width: 1920,
    height: 1080,
    isFullScreen: true,
  },
  monitor: {
    width: 1920,
    height: 1080,
    isFullScreen: true,
  },
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

  getState(windowType: "projector" | "monitor"): WindowState {
    return this.states[windowType];
  }

  saveWindowState(
    windowType: "projector" | "monitor",
    window: BrowserWindow
  ): void {
    const bounds = window.getBounds();
    const display = screen.getDisplayMatching(bounds);

    this.states[windowType] = {
      displayId: display.id,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      isFullScreen: window.isFullScreen(),
    };

    this.saveStates();
  }

  /**
   * Get the best display for a window based on saved state
   */
  getDisplayForWindow(windowType: "projector" | "monitor") {
    const state = this.states[windowType];
    const displays = screen.getAllDisplays();

    // Try to find the saved display
    if (state.displayId) {
      const savedDisplay = displays.find((d) => d.id === state.displayId);
      if (savedDisplay) {
        return savedDisplay;
      }
    }

    // Fallback to selecting displays by index
    if (displays.length > 1) {
      // Projector goes to second display, monitor to third (or second if only 2 displays)
      if (windowType === "projector") {
        return displays[1];
      } else if (windowType === "monitor") {
        return displays.length > 2 ? displays[2] : displays[1];
      }
    }

    // Default to primary display
    return screen.getPrimaryDisplay();
  }

  /**
   * Get window bounds for a specific display and window type
   */
  getWindowBounds(
    windowType: "projector" | "monitor",
    display: Electron.Display
  ): { x: number; y: number; width: number; height: number } {
    const state = this.states[windowType];

    // If we have saved position on this display, use it
    if (state.x !== undefined && state.y !== undefined) {
      return {
        x: state.x,
        y: state.y,
        width: state.width,
        height: state.height,
      };
    }

    // Otherwise, center on the display
    return {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    };
  }

  /**
   * Update state when a window moves or resizes
   */
  updateState(windowType: "projector" | "monitor", window: BrowserWindow): void {
    this.saveWindowState(windowType, window);
  }
}

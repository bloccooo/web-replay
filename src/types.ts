export type MouseEvent = {
  type: "mousemove";
  timestamp: number;
  x: number;
  y: number;
};

export type ScrollEvent = {
  type: "scroll";
  timestamp: number;
  scrollX: number;
  scrollY: number;
  selector: string;
};

export type MouseButtonEvent = {
  type: "mousedown" | "mouseup" | "pointerdown" | "pointerup" | "click";
  timestamp: number;
  x: number;
  y: number;
  button: number;
};

export type KeyboardEvent = {
  type: "keydown" | "keyup";
  timestamp: number;
  key: string;
  code: string;
};

export type NavigationEvent = {
  type: "navigation";
  timestamp: number;
  url: string;
};

export type Event = MouseEvent | MouseButtonEvent | ScrollEvent | KeyboardEvent | NavigationEvent;

export interface Session {
  version: 1;
  startUrl: string;
  viewport: { width: number; height: number; fullscreen: boolean };
  events: Event[];
}

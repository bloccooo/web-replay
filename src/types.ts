export type EventType =
  | "navigate"
  | "mousemove"
  | "mousedown"
  | "mouseup"
  | "wheel"
  | "input"
  | "keydown"
  | "keyup";

interface BaseEvent {
  type: EventType;
  /** Milliseconds since session start */
  t: number;
}

export interface NavigateEvent extends BaseEvent {
  type: "navigate";
  url: string;
}

export interface MouseMoveEvent extends BaseEvent {
  type: "mousemove";
  x: number;
  y: number;
  /** Viewport width at time of recording */
  vw: number;
  /** Viewport height at time of recording */
  vh: number;
}

export interface MouseButtonEvent extends BaseEvent {
  type: "mousedown" | "mouseup";
  x: number;
  y: number;
  vw: number;
  vh: number;
  button: number;
}

export interface WheelEvent extends BaseEvent {
  type: "wheel";
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}

export interface InputEvent extends BaseEvent {
  type: "input";
  value: string;
}

export interface KeyEvent extends BaseEvent {
  type: "keydown" | "keyup";
  key: string;
}

export type SessionEvent =
  | NavigateEvent
  | MouseMoveEvent
  | MouseButtonEvent
  | WheelEvent
  | InputEvent
  | KeyEvent;

export interface Session {
  version: 1;
  startUrl: string;
  viewport: { width: number; height: number };
  events: SessionEvent[];
}

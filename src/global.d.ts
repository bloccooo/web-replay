export {};

declare global {
  interface Window {
    _getVirtualTime: () => Promise<number>;
    _webRecorder: {
      virtualTime: number;
      cursorX: number;
      cursorY: number;
      requestAnimationFrameCallbacks: ((timestamp: number) => void)[];
      timeouts: Array<{
        id: number;
        scheduledAt: number;
        callback: () => void;
      }>;
      intervals: Array<{
        id: number;
        startTime: number;
        interval: number;
        callback: () => void;
        callCount: number;
      }>;
      _timerIdCounter: number;
      animations: Map<
        Element,
        Map<string, { virtualStart: number; duration: number; animationRef: Animation }>
      >;
      scrollTargets: Map<Element, { x: number; y: number }>;
      scrollCurrents: Map<Element, { x: number; y: number }>;
      scrollElement: (el: Element, x: number, y: number) => void;
      scrollWindow: (x: number, y: number) => void;
    };
  }
}

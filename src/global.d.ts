export {};

declare global {
  interface Window {
    _getVirtualTime: () => Promise<number>;
    _webRecorder: {
      virtualTime: number;
      cursorX: number;
      cursorY: number;
      requestAnimationFrameCallbacks: ((timestamp: number) => void)[];
      intervals: Array<{
        id: number;
        startTime: number;
        interval: number;
        callback: () => void;
        callCount: number;
      }>;
      _intervalIdCounter: number;
      animations: Map<
        Element,
        Map<string, { virtualStart: number; duration: number }>
      >;
      scrollTargets: Map<Element, { x: number; y: number }>;
      scrollCurrents: Map<Element, { x: number; y: number }>;
    };
  }
}

// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  // jsdom lacks these browser APIs.
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
  const mem = new Map<string, string>();
  const storage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
    clear: () => mem.clear(),
    key: (i: number) => [...mem.keys()][i] ?? null,
    get length() {
      return mem.size;
    },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === 'undefined') {
    class PE extends MouseEvent {
      pointerId = 1;
    }
    (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = PE;
    (window as unknown as { PointerEvent: unknown }).PointerEvent = PE;
  }
  Element.prototype.setPointerCapture = () => {};
  window.confirm = () => false;
  window.prompt = () => null;
  window.localStorage.setItem('tsg.layout.workspace', JSON.stringify({ w: 'timeline' }));
});

let container: HTMLDivElement | null = null;
afterEach(() => {
  container?.remove();
  container = null;
});

describe('Timeline UI smoke test', () => {
  it('mounts the app in the timeline workspace and adds tracks / clips', async () => {
    const { App } = await import('../../src/ui/App');
    container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const errors: unknown[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
    };
    try {
      await act(async () => {
        root.render(createElement(App));
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
      expect(container.querySelector('.tl-workspace')).not.toBeNull();
      expect(container.querySelector('.tl-toolbar')).not.toBeNull();
      // One empty track was created for the new arrangement.
      expect(container.querySelectorAll('.tl-track-head').length).toBeGreaterThanOrEqual(1);

      const addAudio = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Audio-Spur'));
      await act(async () => {
        addAudio!.click();
      });
      expect(container.querySelectorAll('.tl-track-head').length).toBeGreaterThanOrEqual(2);

      // Place a section by double-clicking it in the media browser.
      const item = container.querySelector('.tl-media-item');
      if (item) {
        await act(async () => {
          item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
        });
        const clip = container.querySelector('.tl-clip') as HTMLElement;
        expect(clip).not.toBeNull();
        await act(async () => {
          clip.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 40, clientY: 30 }));
          window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        });
        expect(container.textContent).toContain('Layer in diesem Clip');
        // Split at the playhead (S) is a no-op at beat 0, Ctrl+D duplicates.
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true }));
        });
        expect(container.querySelectorAll('.tl-clip').length).toBe(2);
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
        });
        expect(container.querySelectorAll('.tl-clip').length).toBe(1);
      }

      // Master inspector
      const master = container.querySelector('.tl-master-head') as HTMLElement;
      await act(async () => {
        master.click();
      });
      expect(container.textContent).toContain('Master-Effekte');

      // Switch back to the Beatkasten.
      const beatTab = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Beatkasten'));
      await act(async () => {
        beatTab!.click();
        await new Promise((r) => setTimeout(r, 10));
      });
      expect(container.querySelector('.tl-workspace')).toBeNull();
    } finally {
      console.error = origError;
      await act(async () => root.unmount());
    }
    const real = errors.filter((e) => !String((e as unknown[])[0]).includes('not wrapped in act'));
    expect(real).toEqual([]);
  });
});

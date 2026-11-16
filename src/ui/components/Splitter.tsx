import { useCallback, useEffect, useRef, useState } from 'react';

interface SplitterProps {
  /** 'col' = senkrechter Balken (Breite ändern), 'row' = waagerechter Balken (Höhe ändern). */
  readonly direction: 'col' | 'row';
  /** Wird beim Ziehen mit der Gesamtverschiebung (px) seit dem Drücken aufgerufen. */
  readonly onDrag: (deltaPx: number) => void;
  readonly onDragStart?: () => void;
  readonly onReset?: () => void;
  readonly title?: string;
}

/** Ziehgriff zum Verändern von Fenstergrößen (Maus & Touch, Doppelklick = zurücksetzen). */
export function Splitter({ direction, onDrag, onDragStart, onReset, title }: SplitterProps) {
  const startRef = useRef<number | null>(null);
  const [active, setActive] = useState(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      startRef.current = direction === 'col' ? e.clientX : e.clientY;
      setActive(true);
      onDragStart?.();
    },
    [direction, onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (startRef.current === null) return;
      const pos = direction === 'col' ? e.clientX : e.clientY;
      onDrag(pos - startRef.current);
    },
    [direction, onDrag],
  );

  const end = useCallback(() => {
    startRef.current = null;
    setActive(false);
  }, []);

  // Während des Ziehens keine Textauswahl und passender Cursor überall.
  useEffect(() => {
    if (!active) return;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = direction === 'col' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
    };
  }, [active, direction]);

  return (
    <div
      className={`splitter splitter-${direction}${active ? ' is-active' : ''}`}
      role="separator"
      aria-orientation={direction === 'col' ? 'vertical' : 'horizontal'}
      title={title ?? 'Ziehen zum Vergrößern/Verkleinern · Doppelklick = Standardgröße'}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
    />
  );
}

/** Kleiner localStorage-Helfer (fehlertolerant, z. B. im privaten Modus). */
export function loadLayoutPref<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(`tsg.layout.${key}`);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function saveLayoutPref(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`tsg.layout.${key}`, JSON.stringify(value));
  } catch {
    // ignorieren
  }
}

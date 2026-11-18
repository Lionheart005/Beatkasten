// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { createNachtschichtProject } from '../../src/core/state/demoSong';
import type { BeatSnapshot } from '../../src/core/state/types';
import { HarmonyBuilderPanel } from '../../src/ui/panels/HarmonyBuilderPanel';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Akkord-Baukasten (jsdom)', () => {
  it('appends plain triads and edits a tile via the combined function/chord menu', () => {
    const project = createNachtschichtProject();
    let snap: BeatSnapshot = {
      ...project.activeSnapshot,
      harmony: { ...project.activeSnapshot.harmony, chordPreset: 'minor7', customSteps: [], progressionMode: 'preset' },
    };
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const render = () =>
      root.render(
        createElement(HarmonyBuilderPanel, {
          snapshot: snap,
          isPlaying: false,
          subscribeTelemetry: () => () => {},
          onCommitSnapshotImmediate: (fn) => {
            snap = fn(snap);
            render();
          },
          onClose: () => {},
        }),
      );
    act(render);

    // No separate "Klassisch" chip row any more.
    expect(host.textContent).not.toContain('Klassisch:');
    const degreeButtons = host.querySelectorAll<HTMLButtonElement>('.degree-btn');
    expect(degreeButtons.length).toBe(11);
    act(() => degreeButtons[1]!.click()); // ii
    const step = snap.harmony.customSteps![0]!;
    expect(step.chordType).toBe('triad');

    const menu = host.querySelector<HTMLSelectElement>('select.chord-menu-select')!;
    expect(menu).toBeTruthy();
    const groups = [...menu.querySelectorAll('optgroup')].map((g) => g.label);
    expect(groups.slice(0, 3)).toEqual(['Tonika', 'Subdominante', 'Dominante']);
    const neapolitan = [...menu.options].find((o) => o.text.startsWith('N⁶'))!;
    act(() => {
      menu.value = neapolitan.value;
      menu.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const edited = snap.harmony.customSteps![0]!;
    expect(edited.templateId).toBe('neapolitan');
    expect(edited.bass).toBe('third');
    expect(host.querySelector('.chord-step-fn')?.textContent).toBe('N⁶');
    act(() => root.unmount());
  });
});

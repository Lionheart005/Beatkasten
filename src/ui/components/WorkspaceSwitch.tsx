import { Grid3x3, ChartGantt } from 'lucide-react';

export type Workspace = 'beat' | 'timeline';

interface WorkspaceSwitchProps {
  value: Workspace;
  onChange: (w: Workspace) => void;
}

/** Tabs „Beatkasten | Timeline“ — switching stops playback. */
export function WorkspaceSwitch({ value, onChange }: WorkspaceSwitchProps) {
  return (
    <div className="segmented workspace-switch" role="tablist" aria-label="Arbeitsbereich">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'beat'}
        className={value === 'beat' ? 'is-active' : undefined}
        onClick={() => onChange('beat')}
        title="Beatkasten: Abschnitte und Klänge bauen"
      >
        <Grid3x3 size={12} /> Beatkasten
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'timeline'}
        className={value === 'timeline' ? 'is-active' : undefined}
        onClick={() => onChange('timeline')}
        title="Timeline: Abschnitte zu einem Song anordnen, Effekte und Übergänge"
      >
        <ChartGantt size={12} /> Timeline
      </button>
    </div>
  );
}

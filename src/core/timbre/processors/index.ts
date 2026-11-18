import type { ProcessorModule } from '../../registry/types';
import { bodySandCard } from './BodySandCard';
import { duckingHallCard } from './DuckingHallCard';
import { eqOrbitCard } from './EqOrbitCard';
import { tempoEchoCard } from './TempoEchoCard';
import { toneFilterCard } from './ToneFilterCard';
import { warmthWavefoldCard } from './WarmthWavefoldCard';
import { tapeStopCard } from './TapeStopCard';
import { beatRepeatCard } from './BeatRepeatCard';
import { evennessCard } from './EvennessCard';

export {
  bodySandCard,
  duckingHallCard,
  eqOrbitCard,
  tempoEchoCard,
  toneFilterCard,
  warmthWavefoldCard,
  tapeStopCard,
  beatRepeatCard,
  evennessCard,
};

export const PROCESSOR_CARDS: readonly ProcessorModule[] = [
  toneFilterCard,
  warmthWavefoldCard,
  bodySandCard,
  eqOrbitCard,
  tempoEchoCard,
  duckingHallCard,
];

/** Extra cards (not part of the default layer chain, available everywhere). */
export const EXTRA_PROCESSOR_CARDS: readonly ProcessorModule[] = [evennessCard, tapeStopCard, beatRepeatCard];

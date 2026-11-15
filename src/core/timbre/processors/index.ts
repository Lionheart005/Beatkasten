import type { ProcessorModule } from '../../registry/types';
import { bodySandCard } from './BodySandCard';
import { duckingHallCard } from './DuckingHallCard';
import { eqOrbitCard } from './EqOrbitCard';
import { tempoEchoCard } from './TempoEchoCard';
import { toneFilterCard } from './ToneFilterCard';
import { warmthWavefoldCard } from './WarmthWavefoldCard';

export {
  bodySandCard,
  duckingHallCard,
  eqOrbitCard,
  tempoEchoCard,
  toneFilterCard,
  warmthWavefoldCard,
};

export const PROCESSOR_CARDS: readonly ProcessorModule[] = [
  toneFilterCard,
  warmthWavefoldCard,
  bodySandCard,
  eqOrbitCard,
  tempoEchoCard,
  duckingHallCard,
];

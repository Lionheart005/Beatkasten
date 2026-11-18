import { ModuleRegistry } from './registry';
import { TIME_OPERATORS } from './time';
import { EXTRA_PROCESSOR_CARDS, PROCESSOR_CARDS, VOICE_MODULES } from './timbre';

export const DEFAULT_PROCESSOR_CHAIN_IDS: readonly string[] = PROCESSOR_CARDS.map(
  (card) => card.id,
);

/**
 * Creates a fresh ModuleRegistry populated with all built-in time operators,
 * voices, and timbre/space processor cards.
 */
export function createDefaultRegistry(): ModuleRegistry {
  const registry = new ModuleRegistry();

  for (const op of TIME_OPERATORS) {
    registry.registerTimeOperator(op);
  }
  for (const voice of VOICE_MODULES) {
    registry.registerVoice(voice);
  }
  for (const card of [...PROCESSOR_CARDS, ...EXTRA_PROCESSOR_CARDS]) {
    registry.registerProcessor(card);
  }

  return registry;
}

export const defaultRegistry: ModuleRegistry = createDefaultRegistry();

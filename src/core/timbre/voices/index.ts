import type { VoiceModule } from '../../registry/types';
import { chordArpVoiceModule } from './ChordArpVoice';
import { pulseTextureVoiceModule } from './PulseTextureVoice';
import { subMotionVoiceModule } from './SubMotionVoice';

export { ChordArpVoice, chordArpVoiceModule } from './ChordArpVoice';
export { PulseTextureVoice, pulseTextureVoiceModule } from './PulseTextureVoice';
export { SubMotionVoice, subMotionVoiceModule } from './SubMotionVoice';

export const VOICE_MODULES: readonly VoiceModule[] = [
  pulseTextureVoiceModule,
  subMotionVoiceModule,
  chordArpVoiceModule,
];

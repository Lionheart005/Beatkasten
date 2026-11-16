import type { VoiceModule } from '../../registry/types';
import { acidLineVoiceModule } from './AcidLineVoice';
import { chordArpVoiceModule } from './ChordArpVoice';
import { clapSnareVoiceModule } from './ClapSnareVoice';
import { fmBassVoiceModule } from './FmBassVoice';
import { hardKickVoiceModule } from './HardKickVoice';
import { metalHatVoiceModule } from './MetalHatVoice';
import { noiseRiserVoiceModule } from './NoiseRiserVoice';
import { modalBellVoiceModule } from './ModalBellVoice';
import { pipeOrganVoiceModule } from './PipeOrganVoice';
import { pulseTextureVoiceModule } from './PulseTextureVoice';
import { reeseBassVoiceModule } from './ReeseBassVoice';
import { subMotionVoiceModule } from './SubMotionVoice';

export { AcidLineVoice, acidLineVoiceModule } from './AcidLineVoice';
export { ChordArpVoice, chordArpVoiceModule } from './ChordArpVoice';
export { ClapSnareVoice, clapSnareVoiceModule } from './ClapSnareVoice';
export { FmBassVoice, fmBassVoiceModule } from './FmBassVoice';
export { HardKickVoice, hardKickVoiceModule } from './HardKickVoice';
export { ReeseBassVoice, reeseBassVoiceModule } from './ReeseBassVoice';
export { MetalHatVoice, metalHatVoiceModule } from './MetalHatVoice';
export { NoiseRiserVoice, noiseRiserVoiceModule } from './NoiseRiserVoice';
export { ModalBellVoice, modalBellVoiceModule } from './ModalBellVoice';
export { PipeOrganVoice, pipeOrganVoiceModule } from './PipeOrganVoice';
export { PulseTextureVoice, pulseTextureVoiceModule } from './PulseTextureVoice';
export { SubMotionVoice, subMotionVoiceModule } from './SubMotionVoice';

export const VOICE_MODULES: readonly VoiceModule[] = [
  pulseTextureVoiceModule,
  hardKickVoiceModule,
  metalHatVoiceModule,
  clapSnareVoiceModule,
  subMotionVoiceModule,
  acidLineVoiceModule,
  reeseBassVoiceModule,
  fmBassVoiceModule,
  chordArpVoiceModule,
  modalBellVoiceModule,
  pipeOrganVoiceModule,
  noiseRiserVoiceModule,
];

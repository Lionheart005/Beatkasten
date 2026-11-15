import type {
  ModuleDescriptor,
  ProcessorModule,
  TimeOperatorModule,
  VoiceModule,
} from './types';

/**
 * Central registry for time operators, voices, and audio processors.
 * Enforces descriptor validity and unique module/parameter identifiers.
 */
export class ModuleRegistry {
  private readonly timeOperators = new Map<string, TimeOperatorModule>();
  private readonly voices = new Map<string, VoiceModule>();
  private readonly processors = new Map<string, ProcessorModule>();

  public validateDescriptor(descriptor: ModuleDescriptor): void {
    if (!descriptor.id || descriptor.id.trim().length === 0) {
      throw new Error('Module descriptor id must be a non-empty string.');
    }
    if (!Number.isInteger(descriptor.version) || descriptor.version < 1) {
      throw new Error(
        `Module "${descriptor.id}" has invalid version ${descriptor.version}; expected integer >= 1.`,
      );
    }

    const seenParamIds = new Set<string>();
    for (const param of descriptor.parameters) {
      if (!param.id || param.id.trim().length === 0) {
        throw new Error(`Module "${descriptor.id}" contains a parameter with an empty id.`);
      }
      if (seenParamIds.has(param.id)) {
        throw new Error(
          `Module "${descriptor.id}" defines duplicate parameter id "${param.id}".`,
        );
      }
      seenParamIds.add(param.id);

      if (
        !Number.isFinite(param.min) ||
        !Number.isFinite(param.max) ||
        !Number.isFinite(param.defaultValue)
      ) {
        throw new Error(
          `Module "${descriptor.id}" parameter "${param.id}" has non-finite bounds or defaultValue.`,
        );
      }
      if (param.min > param.defaultValue || param.defaultValue > param.max) {
        throw new Error(
          `Module "${descriptor.id}" parameter "${param.id}" violates min <= defaultValue <= max (${param.min} <= ${param.defaultValue} <= ${param.max}).`,
        );
      }
      if (param.step !== undefined && (!Number.isFinite(param.step) || param.step <= 0)) {
        throw new Error(
          `Module "${descriptor.id}" parameter "${param.id}" has invalid step ${param.step}.`,
        );
      }
    }
  }

  private assertUniqueModuleId(id: string): void {
    if (
      this.timeOperators.has(id) ||
      this.voices.has(id) ||
      this.processors.has(id)
    ) {
      throw new Error(`Duplicate module id "${id}" in ModuleRegistry.`);
    }
  }

  public registerTimeOperator(module: TimeOperatorModule): void {
    this.validateDescriptor(module);
    this.assertUniqueModuleId(module.id);
    this.timeOperators.set(module.id, module);
  }

  public registerVoice(module: VoiceModule): void {
    this.validateDescriptor(module);
    this.assertUniqueModuleId(module.id);
    this.voices.set(module.id, module);
  }

  public registerProcessor(module: ProcessorModule): void {
    this.validateDescriptor(module);
    this.assertUniqueModuleId(module.id);
    this.processors.set(module.id, module);
  }

  public getTimeOperator(id: string): TimeOperatorModule | undefined {
    return this.timeOperators.get(id);
  }

  public getVoice(id: string): VoiceModule | undefined {
    return this.voices.get(id);
  }

  public getProcessor(id: string): ProcessorModule | undefined {
    return this.processors.get(id);
  }

  public listTimeOperators(): readonly TimeOperatorModule[] {
    return Array.from(this.timeOperators.values());
  }

  public listVoices(): readonly VoiceModule[] {
    return Array.from(this.voices.values());
  }

  public listProcessors(): readonly ProcessorModule[] {
    return Array.from(this.processors.values());
  }
}

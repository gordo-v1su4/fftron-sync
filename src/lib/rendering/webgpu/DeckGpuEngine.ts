import { resolveDeckGpuCapability } from './capability';
import { DeckRenderTargetManager } from './DeckRenderTargetManager';
import type { DeckGpuCapabilityInput, DeckRenderPlan, DeckSourceSnapshot } from './types';

export class DeckGpuEngine {
  private readonly targetManager: DeckRenderTargetManager;

  constructor(targetManager = new DeckRenderTargetManager()) {
    this.targetManager = targetManager;
  }

  planPresentation(snapshot: DeckSourceSnapshot, capabilityInput: DeckGpuCapabilityInput): DeckRenderPlan {
    const capability = resolveDeckGpuCapability(capabilityInput);
    return this.targetManager.createPlan(snapshot, capability);
  }
}

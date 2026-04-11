import type { OnsetTransportState } from "$lib/stores/runtime";

export interface OnsetTransportPresentation {
  headline: string;
  detail: string;
  tone: "neutral" | "armed" | "warning";
}

const progressModeLabel = (mode: OnsetTransportState["progressMode"]): string => {
  switch (mode) {
    case "detected-fallback":
      return "Detected fallback";
    case "quantized":
      return "Quantized boundary";
    case "analyzed":
    default:
      return "Analyzed onsets";
  }
};

export function describeOnsetTransportState(
  state: OnsetTransportState,
): OnsetTransportPresentation {
  const progress = `${state.progressCount}/${state.target}`;
  const sourceLabel = progressModeLabel(state.progressMode);

  if (state.blockedReason) {
    return {
      headline: "Holding switch",
      detail: `${sourceLabel} · ${progress} · ${state.blockedReason}`,
      tone: "warning",
    };
  }

  if (state.armed) {
    return {
      headline: "Switch armed",
      detail: `${sourceLabel} · ${progress} · awaiting next transport boundary`,
      tone: "armed",
    };
  }

  if (state.progressCount > 0) {
    return {
      headline: "Counting onsets",
      detail: `${sourceLabel} · ${progress}`,
      tone: "neutral",
    };
  }

  return {
    headline: "Waiting for count",
    detail: `${sourceLabel} · ${progress}`,
    tone: "neutral",
  };
}

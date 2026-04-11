export interface AutomationBoundsLike {
  speedMin: number;
  speedMax: number;
  stutterMin: number;
  stutterMax: number;
}

interface NumericDomain {
  min: number;
  max: number;
}

export const SPEED_AUTOMATION_DOMAIN: NumericDomain = {
  min: 0.25,
  max: 4,
};

export const STUTTER_AUTOMATION_DOMAIN: NumericDomain = {
  min: 0,
  max: 1,
};

export const clampValue = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const mapNormalizedToRange = (
  normalized: number,
  min: number,
  max: number,
): number => min + clampValue(normalized, 0, 1) * (max - min);

export const mapRangeToNormalized = (
  value: number,
  min: number,
  max: number,
): number => {
  const span = Math.max(0.0001, max - min);
  return clampValue((value - min) / span, 0, 1);
};

const normalizeDomainBounds = (
  requestedMin: number,
  requestedMax: number,
  domain: NumericDomain,
  minGap: number,
): NumericDomain => {
  const normalizedMin = clampValue(
    Math.min(requestedMin, requestedMax - minGap),
    domain.min,
    domain.max - minGap,
  );
  const normalizedMax = clampValue(
    Math.max(requestedMax, normalizedMin + minGap),
    normalizedMin + minGap,
    domain.max,
  );

  return {
    min: normalizedMin,
    max: normalizedMax,
  };
};

export const normalizeAutomationBounds = (
  bounds: AutomationBoundsLike,
): AutomationBoundsLike => {
  const speedBounds = normalizeDomainBounds(
    bounds.speedMin,
    bounds.speedMax,
    SPEED_AUTOMATION_DOMAIN,
    0.01,
  );
  const stutterBounds = normalizeDomainBounds(
    bounds.stutterMin,
    bounds.stutterMax,
    STUTTER_AUTOMATION_DOMAIN,
    0.001,
  );

  return {
    speedMin: speedBounds.min,
    speedMax: speedBounds.max,
    stutterMin: stutterBounds.min,
    stutterMax: stutterBounds.max,
  };
};

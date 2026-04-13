<script lang="ts">
  import { onMount } from "svelte";
  import {
    activeSection,
    audioOnsets,
    automationBounds,
    automationRuntime,
    essentiaAnalysis,
    markers,
    tempoState,
    waveformOverview,
  } from "$lib/stores/runtime";
  import { buildWaveformViewportPath } from "$lib/audio/wav";
  import { buildTimelineOnsetLanes, type TimelineOnsetMarker } from "$lib/timeline/onsetMarkers";
  import {
    buildEssentiaPunchSpeedPresets,
    buildSpeedLanePresets,
    buildStutterLanePresets,
    type CurvePoint,
    type InterpolationMode,
    type TrackPreset,
  } from "$lib/timeline/externalCurvePresets";
  import {
    SPEED_AUTOMATION_DOMAIN,
    STUTTER_AUTOMATION_DOMAIN,
    clampValue,
    mapNormalizedToRange,
    mapRangeToNormalized,
    normalizeAutomationBounds,
  } from "$lib/runtime/automationBounds";

  export let duration = 0;
  export let currentTime = 0;
  export let onSeek: (time: number) => void = () => {};
  export let autoSwitchEnabled = false;
  export let quantizeMode: "beat" | "bar" = "beat";
  export let onToggleAutoSwitch: () => void = () => {};
  export let onSetQuantizeMode: (mode: "beat" | "bar") => void = () => {};

  interface DragState {
    track: "speed";
    index: number;
  }

  interface AutomationPreset {
    id: string;
    name: string;
    stutterPoints: CurvePoint[];
    speedPoints: CurvePoint[];
    stutterInterpolation: InterpolationMode;
    speedInterpolation: InterpolationMode;
  }

  type TimelineLaneId = "waveform" | "stutter" | "speed";

  const markerTagAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const zoomSteps = [1, 2, 4, 8, 16];
  const laneLabelWidthPx = 110;
  const speedPhaseOptions = [
    { label: "0.5x", value: 0.5 },
    { label: "1x", value: 1 },
    { label: "2x", value: 2 },
    { label: "4x", value: 4 },
    { label: "8x", value: 8 },
    { label: "16x", value: 16 },
  ] as const;
  const followViewportBackstopRatio = 0.28;
  const followViewportLeadRatio = 0.72;
  const followViewportSnapRatio = 0.4;
  const speedDomainMin = SPEED_AUTOMATION_DOMAIN.min;
  const speedDomainMax = SPEED_AUTOMATION_DOMAIN.max;
  const stutterDomainMin = STUTTER_AUTOMATION_DOMAIN.min;
  const stutterDomainMax = STUTTER_AUTOMATION_DOMAIN.max;
  const clamp = clampValue;
  const buildNeutralSpeedPoints = (
    minBound = speedDomainMin,
    maxBound = speedDomainMax,
  ): CurvePoint[] => {
    const neutral = mapRangeToNormalized(1, minBound, maxBound);
    return [
      { x: 0, y: neutral },
      { x: 1, y: neutral },
    ];
  };

  let zoomLevel = 1;
  let followPlayhead = true;
  let followViewportStart = 0;
  let manualViewportStart = 0;

  let stutterInterpolation: InterpolationMode = "smoothstep";
  let speedInterpolation: InterpolationMode = "ease_in";

  let stutterPoints: CurvePoint[] = [
    { x: 0, y: 0.1 },
    { x: 0.12, y: 0.9 },
    { x: 0.24, y: 0.2 },
    { x: 0.34, y: 0.95 },
    { x: 0.5, y: 0.25 },
    { x: 0.62, y: 0.88 },
    { x: 0.78, y: 0.22 },
    { x: 0.9, y: 0.92 },
    { x: 1, y: 0.12 },
  ];

  let speedPoints: CurvePoint[] = buildNeutralSpeedPoints();
  let stutterPresetId = "manual";
  let speedPresetId = "manual";
  let lastAppliedPresetKey = "";
  let lastSpeedPresetRefreshKey = "";
  let speedPresetRefreshKey = "";
  let lastAutomationSpeed = 0.5;
  let lastAutomationStutter = 0;
  let laneMuteState: Record<TimelineLaneId, boolean> = {
    waveform: false,
    stutter: false,
    speed: false,
  };
  let laneSoloState: TimelineLaneId | null = null;
  let timelineSections: Array<{
    id: string;
    section: string;
    label: string;
    start: number;
    end: number;
    energy: number;
  }> = [];
  let sectionButtonItems: Array<{
    section: string;
    label: string;
    rawLabel: string;
    start: number;
    end: number;
    index: number;
    total: number;
  }> = [];
  let authoritativeOnsetMarkers: TimelineOnsetMarker[] = [];
  let _ignoredLiveFallback: TimelineOnsetMarker[] = [];
  let _ignoredCountedDebug: TimelineOnsetMarker[] = [];
  let sectionBands: Array<{
    section: string;
    label: string;
    energy: number;
    left: number;
    width: number;
  }> = [];
  let generatedSpeedPresets: TrackPreset[] = [];
  let availableSpeedPresets: TrackPreset[] = [];
  let essentiaPunchSpeedPresets: TrackPreset[] = [];
  let essentiaPreset: AutomationPreset | null = null;
  let essentiaStutterPreset: TrackPreset | null = null;
  let essentiaSpeedPreset: TrackPreset | null = null;
  let visibleSpeedPoints: Array<{
    index: number;
    point: CurvePoint;
    localPercent: number;
  }> = [];
  let currentSpeedValue = 0.5;
  let speedMinBound = 0.5;
  let speedMaxBound = 3;
  let stutterMinBound = 0;
  let stutterMaxBound = 1;
  let currentSpeedRate = 1;
  let currentStutterAmount = 0;
  let speedNeutralDisplayNorm = 0.5;
  let timelineBpm = 120;
  let speedPhaseMultiplier = 1;
  let normalizedAutomationBounds = {
    speedMin: 0.5,
    speedMax: 3,
    stutterMin: 0,
    stutterMax: 1,
  };

  let speedEditorEl: HTMLDivElement | null = null;
  let activeDrag: DragState | null = null;

  const formatClock = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const prettifySectionLabel = (label: string): string =>
    label
      .replace(/[-_]+/g, " ")
      .trim()
      .replace(/\b\w/g, (value) => value.toUpperCase());

  const formatClockWithCentis = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, "0");
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    const centis = Math.floor((seconds % 1) * 100)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}.${centis}`;
  };

  const easingForMode = (mode: InterpolationMode, t: number): number => {
    const clamped = clamp(t, 0, 1);
    switch (mode) {
      case "ease_in":
        return clamped * clamped;
      case "ease_out":
        return 1 - (1 - clamped) * (1 - clamped);
      case "smoothstep":
        return clamped * clamped * (3 - 2 * clamped);
      case "step":
        return clamped >= 1 ? 1 : 0;
      case "linear":
      default:
        return clamped;
    }
  };

  const evaluateCurveY = (
    points: CurvePoint[],
    mode: InterpolationMode,
    xNorm: number,
  ): number => {
    if (points.length === 0) return 0;
    if (xNorm <= points[0].x) return points[0].y;
    if (xNorm >= points[points.length - 1].x) return points[points.length - 1].y;

    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (xNorm >= from.x && xNorm <= to.x) {
        const span = Math.max(0.0001, to.x - from.x);
        const t = (xNorm - from.x) / span;
        const eased = easingForMode(mode, t);
        return from.y + (to.y - from.y) * eased;
      }
    }

    return points[points.length - 1].y;
  };

  const buildAutomationPaths = (
    points: CurvePoint[],
    mode: InterpolationMode,
    width: number,
    height: number,
  ): { line: string; fill: string } => {
    if (points.length < 2) {
      const base = height - 2;
      return {
        line: `M 0,${base} L ${width},${base}`,
        fill: `M 0,${base} L ${width},${base} L ${width},${height} L 0,${height} Z`,
      };
    }

    if (mode === "step") {
      const first = points[0];
      let line = `M ${first.x * width},${height - first.y * height} `;

      for (let index = 0; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const x2 = next.x * width;
        const y1 = height - current.y * height;
        const y2 = height - next.y * height;
        line += `L ${x2},${y1} L ${x2},${y2} `;
      }

      return {
        line,
        fill: `${line}L ${width},${height} L 0,${height} Z`,
      };
    }

    const samples = 240;
    let line = "";
    for (let index = 0; index <= samples; index += 1) {
      const xNorm = index / samples;
      const yNorm = evaluateCurveY(points, mode, xNorm);
      const x = xNorm * width;
      const y = height - yNorm * height;
      line += index === 0 ? `M ${x},${y} ` : `L ${x},${y} `;
    }

    return {
      line,
      fill: `${line}L ${width},${height} L 0,${height} Z`,
    };
  };

  const buildViewportCurveSampleXs = (
    points: CurvePoint[],
    viewportStartNorm: number,
    viewportEndNorm: number,
  ): number[] => {
    const xs = new Set<number>();
    const viewportSpan = Math.max(0.0001, viewportEndNorm - viewportStartNorm);
    const denseSamples = Math.min(
      4000,
      Math.max(900, Math.round(900 / viewportSpan)),
    );

    for (let index = 0; index <= denseSamples; index += 1) {
      xs.add(viewportStartNorm + viewportSpan * (index / denseSamples));
    }

    xs.add(viewportStartNorm);
    xs.add(viewportEndNorm);

    for (const point of points) {
      if (point.x >= viewportStartNorm && point.x <= viewportEndNorm) {
        xs.add(point.x);
      }
    }

    return Array.from(xs).sort((left, right) => left - right);
  };

  const buildViewportStepPath = (
    points: CurvePoint[],
    width: number,
    height: number,
    viewportStartNorm: number,
    viewportEndNorm: number,
  ): string => {
    const viewportSpan = Math.max(0.0001, viewportEndNorm - viewportStartNorm);
    const safePoints = points.length
      ? points
      : [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ];
    const anchors: CurvePoint[] = [
      {
        x: viewportStartNorm,
        y: evaluateCurveY(safePoints, "step", viewportStartNorm),
      },
      ...safePoints.filter(
        (point) => point.x > viewportStartNorm && point.x < viewportEndNorm,
      ),
      {
        x: viewportEndNorm,
        y: evaluateCurveY(safePoints, "step", viewportEndNorm),
      },
    ];

    const first = anchors[0];
    let line = `M 0,${height - first.y * height} `;

    for (let index = 0; index < anchors.length - 1; index += 1) {
      const current = anchors[index];
      const next = anchors[index + 1];
      const nextLocalNorm = (next.x - viewportStartNorm) / viewportSpan;
      const x2 = nextLocalNorm * width;
      const y1 = height - current.y * height;
      const y2 = height - next.y * height;
      line += `L ${x2},${y1} L ${x2},${y2} `;
    }

    return line;
  };

  const buildViewportAutomationPaths = (
    points: CurvePoint[],
    mode: InterpolationMode,
    width: number,
    height: number,
    viewportStartNorm: number,
    viewportEndNorm: number,
  ): { line: string; fill: string } => {
    const viewportSpan = Math.max(0.0001, viewportEndNorm - viewportStartNorm);
    const safePoints = points.length
      ? points
      : [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
        ];

    if (mode === "step") {
      const line = buildViewportStepPath(
        safePoints,
        width,
        height,
        viewportStartNorm,
        viewportEndNorm,
      );
      return {
        line,
        fill: `${line}L ${width},${height} L 0,${height} Z`,
      };
    }

    const sampleXs = buildViewportCurveSampleXs(
      safePoints,
      viewportStartNorm,
      viewportEndNorm,
    );
    let line = "";

    for (let index = 0; index < sampleXs.length; index += 1) {
      const globalNorm = sampleXs[index];
      const localNorm = (globalNorm - viewportStartNorm) / viewportSpan;
      const yNorm = evaluateCurveY(safePoints, mode, globalNorm);
      const x = localNorm * width;
      const y = height - yNorm * height;
      line += index === 0 ? `M ${x},${y} ` : `L ${x},${y} `;
    }

    return {
      line,
      fill: `${line}L ${width},${height} L 0,${height} Z`,
    };
  };

  const toLocalPercent = (
    xNorm: number,
    viewportStartNorm: number,
    viewportWindowNorm: number,
  ): number => ((xNorm - viewportStartNorm) / viewportWindowNorm) * 100;

  const clipPointsToViewport = (
    points: CurvePoint[],
    viewportStartNorm: number,
    viewportEndNorm: number,
  ) =>
    points
      .map((point, index) => ({
        index,
        point,
        localPercent: toLocalPercent(
          point.x,
          viewportStartNorm,
          viewportEndNorm - viewportStartNorm,
        ),
      }))
      .filter((entry) => entry.localPercent >= -2 && entry.localPercent <= 102);

  const uniqueSortedPoints = (points: CurvePoint[]): CurvePoint[] => {
    const sorted = [...points]
      .map((point) => ({ x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) }))
      .sort((a, b) => a.x - b.x);
    const unique: CurvePoint[] = [];
    for (const point of sorted) {
      const previous = unique[unique.length - 1];
      if (!previous || Math.abs(previous.x - point.x) > 0.0001) {
        unique.push(point);
      }
    }
    if (!unique.length || unique[0].x > 0) unique.unshift({ x: 0, y: 0.1 });
    if (unique[unique.length - 1].x < 1)
      unique.push({ x: 1, y: unique[unique.length - 1].y });
    unique[0] = { ...unique[0], x: 0 };
    unique[unique.length - 1] = { ...unique[unique.length - 1], x: 1 };
    return unique;
  };

  const createBuiltInPresets = (): AutomationPreset[] => [
    {
      id: "manual",
      name: "Manual",
      stutterPoints,
      speedPoints,
      stutterInterpolation,
      speedInterpolation,
    },
    {
      id: "rise-drop",
      name: "Rise + Drop",
      stutterPoints: [
        { x: 0, y: 0.06 },
        { x: 0.2, y: 0.22 },
        { x: 0.42, y: 0.82 },
        { x: 0.48, y: 0.15 },
        { x: 0.7, y: 0.5 },
        { x: 1, y: 0.12 },
      ],
      speedPoints: [
        { x: 0, y: 0.22 },
        { x: 0.35, y: 0.48 },
        { x: 0.5, y: 0.9 },
        { x: 0.58, y: 0.24 },
        { x: 0.78, y: 0.65 },
        { x: 1, y: 0.88 },
      ],
      stutterInterpolation: "smoothstep",
      speedInterpolation: "ease_in",
    },
    {
      id: "chop-gate",
      name: "Chop Gate",
      stutterPoints: [
        { x: 0, y: 0.04 },
        { x: 0.1, y: 0.92 },
        { x: 0.2, y: 0.06 },
        { x: 0.3, y: 0.88 },
        { x: 0.4, y: 0.05 },
        { x: 0.52, y: 0.9 },
        { x: 0.66, y: 0.08 },
        { x: 0.82, y: 0.86 },
        { x: 1, y: 0.07 },
      ],
      speedPoints: [
        { x: 0, y: 0.55 },
        { x: 0.5, y: 0.55 },
        { x: 1, y: 0.55 },
      ],
      stutterInterpolation: "step",
      speedInterpolation: "linear",
    },
  ];

  const createEssentiaPreset = (): AutomationPreset | null => {
    if ($essentiaAnalysis.sections.length < 1) return null;
    const baseDuration =
      $essentiaAnalysis.duration ??
      $essentiaAnalysis.sections[$essentiaAnalysis.sections.length - 1]?.end ??
      0;
    if (!Number.isFinite(baseDuration) || baseDuration <= 0) return null;

    const energyValues = $essentiaAnalysis.sections.map((section) => section.energy);
    const minEnergy = Math.min(...energyValues);
    const maxEnergy = Math.max(...energyValues);
    const energySpan = Math.max(0.0001, maxEnergy - minEnergy);
    const normalizeEnergy = (energy: number): number =>
      clamp((energy - minEnergy) / energySpan, 0, 1);

    const speedPresetPoints: CurvePoint[] = [];
    const stutterPresetPoints: CurvePoint[] = [];

    for (const section of $essentiaAnalysis.sections) {
      const startNorm = clamp(section.start / baseDuration, 0, 1);
      const endNorm = clamp(section.end / baseDuration, 0, 1);
      const energyNorm = normalizeEnergy(section.energy);
      const speedY = clamp(0.22 + energyNorm * 0.72, 0.08, 0.96);
      const stutterY = clamp((1 - energyNorm) * 0.8, 0.03, 0.92);

      speedPresetPoints.push({ x: startNorm, y: speedY });
      stutterPresetPoints.push({ x: startNorm, y: stutterY });
      speedPresetPoints.push({ x: endNorm, y: clamp(speedY * 0.92, 0.08, 0.96) });
      stutterPresetPoints.push({
        x: clamp(endNorm - 0.005, 0, 1),
        y: clamp(stutterY * 1.08, 0.03, 0.95),
      });
    }

    return {
      id: "essentia-derived",
      name: "Essentia Derived",
      speedPoints: uniqueSortedPoints(speedPresetPoints),
      stutterPoints: uniqueSortedPoints(stutterPresetPoints),
      speedInterpolation: "smoothstep",
      stutterInterpolation: "step",
    };
  };

  const setZoom = (nextZoom: number) => {
    const clamped = clamp(nextZoom, zoomSteps[0], zoomSteps[zoomSteps.length - 1]);
    const currentWindow = 1 / zoomLevel;
    const center =
      followPlayhead
        ? progress / 100
        : manualViewportStart + currentWindow / 2;

    zoomLevel = clamped;
    const nextWindow = 1 / zoomLevel;
    manualViewportStart = clamp(center - nextWindow / 2, 0, 1 - nextWindow);
    if (followPlayhead) {
      followViewportStart = clamp(
        center - nextWindow * followViewportSnapRatio,
        0,
        1 - nextWindow,
      );
    }
  };

  const setZoomAround = (nextZoom: number, anchorRatio: number) => {
    const clamped = clamp(nextZoom, zoomSteps[0], zoomSteps[zoomSteps.length - 1]);
    const currentWindow = 1 / zoomLevel;
    const anchor = clamp(anchorRatio, 0, 1);
    const viewportBaseStart = followPlayhead
      ? followViewportStart
      : manualViewportStart;
    const anchorGlobal = viewportBaseStart + anchor * currentWindow;

    zoomLevel = clamped;
    const nextWindow = 1 / zoomLevel;
    manualViewportStart = clamp(anchorGlobal - anchor * nextWindow, 0, 1 - nextWindow);
    followPlayhead = false;
  };

  const zoomIn = () => {
    const index = zoomSteps.indexOf(zoomLevel);
    if (index >= 0 && index < zoomSteps.length - 1) {
      setZoom(zoomSteps[index + 1]);
    }
  };

  const zoomOut = () => {
    const index = zoomSteps.indexOf(zoomLevel);
    if (index > 0) {
      setZoom(zoomSteps[index - 1]);
    }
  };

  const panViewport = (direction: -1 | 1) => {
    followPlayhead = false;
    manualViewportStart = clamp(
      manualViewportStart + direction * (1 / zoomLevel) * 0.2,
      0,
      1 - 1 / zoomLevel,
    );
  };

  const seekBy = (deltaSeconds: number) => {
    onSeek(clamp(currentTime + deltaSeconds, 0, safeDuration));
  };

  const setFollowPlayheadEnabled = (enabled: boolean) => {
    if (enabled) {
      followViewportStart = clamp(
        progress / 100 - viewportWindow * followViewportSnapRatio,
        0,
        1 - viewportWindow,
      );
      followPlayhead = true;
      return;
    }
    manualViewportStart = viewportStart;
    followPlayhead = false;
  };

  const handleTimelineKeydown = (event: KeyboardEvent) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      followPlayhead = false;
      seekBy(event.shiftKey ? -5 : -1);
      return;
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      followPlayhead = false;
      seekBy(event.shiftKey ? 5 : 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      followPlayhead = false;
      onSeek(0);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      followPlayhead = false;
      onSeek(safeDuration);
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      setFollowPlayheadEnabled(!followPlayhead);
    }
  };

  const handleTimelineWheel = (event: WheelEvent) => {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    const anchorRatio =
      rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0.5;

    if (!event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX)) {
      if (event.deltaY < 0) {
        zoomIn();
      } else {
        zoomOut();
      }
      setZoomAround(zoomLevel, anchorRatio);
      return;
    }

    followPlayhead = false;
    manualViewportStart = clamp(
      manualViewportStart + (event.deltaX + event.deltaY) * 0.00045 * viewportWindow,
      0,
      1 - viewportWindow,
    );
  };

  const scrub = (event: Event) => {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    onSeek(value);
  };

  const startCurveDrag = (track: "speed", index: number, event: MouseEvent) => {
    event.preventDefault();
    activeDrag = { track, index };
  };

  const applyDragUpdate = (event: MouseEvent) => {
    if (!activeDrag) return;
    const container = speedEditorEl;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const viewportSpan = Math.max(0.0001, viewportEnd - viewportStart);
    const localXNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const xNormRaw = clamp(viewportStart + localXNorm * viewportSpan, 0, 1);
    const displayYNorm = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);
    const yNorm = mapRangeToNormalized(
      mapNormalizedToRange(displayYNorm, speedDomainMin, speedDomainMax),
      speedMinBound,
      speedMaxBound,
    );

    const points = [...speedPoints];

    const index = activeDrag.index;
    const previous = points[index - 1];
    const next = points[index + 1];
    const minX = index === 0 ? 0 : (previous?.x ?? 0) + 0.01;
    const maxX = index === points.length - 1 ? 1 : (next?.x ?? 1) - 0.01;

    let xNorm = clamp(xNormRaw, minX, maxX);
    if (index === 0) xNorm = 0;
    if (index === points.length - 1) xNorm = 1;

    points[index] = {
      x: xNorm,
      y: yNorm,
    };

    speedPoints = points;
    speedPresetId = "manual";
  };

  const endCurveDrag = () => {
    activeDrag = null;
  };

  const resetStutter = () => {
    stutterPresetId = "manual";
    stutterPoints = [
      { x: 0, y: 0.1 },
      { x: 0.12, y: 0.9 },
      { x: 0.24, y: 0.2 },
      { x: 0.34, y: 0.95 },
      { x: 0.5, y: 0.25 },
      { x: 0.62, y: 0.88 },
      { x: 0.78, y: 0.22 },
      { x: 0.9, y: 0.92 },
      { x: 1, y: 0.12 },
    ];
  };

  const resetSpeed = () => {
    speedPresetId = "manual";
    speedPoints = buildNeutralSpeedPoints(speedMinBound, speedMaxBound);
  };

  const applyPreset = (presetId: string, track: "speed") => {
    const presetList = availableSpeedPresets;
    const preset = presetList.find((entry) => entry.id === presetId);
    if (!preset) return;

    speedPoints = uniqueSortedPoints(
      preset.points.map((point) => ({ ...point })),
    );
    speedInterpolation = preset.interpolation;
    speedPresetId = preset.id;
  };

  const seekToSection = (sectionName: string) => {
    const targetSection = timelineSections.find(
      (entry) => entry.section === sectionName,
    );
    activeSection.set(sectionName);
    if (targetSection) {
      onSeek(targetSection.start);
      followPlayhead = true;
    }
  };

  const toggleLaneMute = (lane: TimelineLaneId) => {
    laneMuteState = {
      ...laneMuteState,
      [lane]: !laneMuteState[lane],
    };
    if (laneMuteState[lane] && laneSoloState === lane) {
      laneSoloState = null;
    }
  };

  const toggleLaneSolo = (lane: TimelineLaneId) => {
    laneSoloState = laneSoloState === lane ? null : lane;
  };

  const extractTimedSectionsFromMarkers = (
    safeDurationSeconds: number,
  ): Array<{
    id: string;
    section: string;
    label: string;
    start: number;
    end: number;
    energy: number;
  }> => {
    const fromMarkers = $markers
      .map((marker, index) => {
        const payload = marker.payload as Record<string, unknown>;
        const startRaw = payload.start;
        const endRaw = payload.end;
        const energyRaw = payload.energy;
        const labelRaw = payload.label;
        const sourceRaw = payload.source;
        const start = typeof startRaw === "number" ? startRaw : null;
        const end = typeof endRaw === "number" ? endRaw : null;
        const energy = typeof energyRaw === "number" ? energyRaw : 0.5;
        const label =
          typeof labelRaw === "string" && labelRaw.trim().length > 0
            ? labelRaw
            : marker.section;
        const isEssentiaMarker = sourceRaw === "essentia";
        return {
          id: marker.id || `mk-${index + 1}`,
          section: marker.section,
          label,
          start,
          end,
          energy,
          isEssentiaMarker,
        };
      })
      .filter((entry) => entry.start !== null && entry.isEssentiaMarker)
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

    if (!fromMarkers.length) {
      return [];
    }

    return fromMarkers.map((entry, index) => {
      const start = entry.start ?? 0;
      const end =
        entry.end ??
        (fromMarkers[index + 1]?.start ?? safeDurationSeconds);
      return {
        id: entry.id,
        section: entry.section,
        label: entry.label,
        start: clamp(start, 0, safeDurationSeconds),
        end: clamp(Math.max(start + 0.01, end), 0, safeDurationSeconds),
        energy: clamp(entry.energy, 0, 1),
      };
    });
  };

  onMount(() => {
    if (typeof window === "undefined") return;
    window.addEventListener("mousemove", applyDragUpdate);
    window.addEventListener("mouseup", endCurveDrag);

    return () => {
      window.removeEventListener("mousemove", applyDragUpdate);
      window.removeEventListener("mouseup", endCurveDrag);
    };
  });

  $: safeDuration = duration > 0 ? duration : 1;
  $: progress = Math.min(Math.max(currentTime / safeDuration, 0), 1) * 100;

  $: sectionEnergyValues = $essentiaAnalysis.sections.map((section) => section.energy);
  $: sectionEnergyMin = sectionEnergyValues.length
    ? Math.min(...sectionEnergyValues)
    : 0;
  $: sectionEnergyMax = sectionEnergyValues.length
    ? Math.max(...sectionEnergyValues)
    : 1;
  $: sectionEnergySpan = Math.max(0.0001, sectionEnergyMax - sectionEnergyMin);
  $: timelineSections = $essentiaAnalysis.sections.length
    ? $essentiaAnalysis.sections.map((section) => ({
        id: section.id,
        section: section.section,
        label: section.label || section.section,
        start: clamp(section.start, 0, safeDuration),
        end: clamp(Math.max(section.start + 0.01, section.end), 0, safeDuration),
        energy: clamp((section.energy - sectionEnergyMin) / sectionEnergySpan, 0, 1),
      }))
    : extractTimedSectionsFromMarkers(safeDuration);

  $: currentSection = timelineSections.find(
    (section) => currentTime >= section.start && currentTime < section.end,
  );
  $: if (currentSection && $activeSection !== currentSection.section) {
    activeSection.set(currentSection.section);
  }
  $: if (!timelineSections.length && $activeSection !== "") {
    activeSection.set("");
  }

  $: sectionButtonItems = (() => {
    const totals = new Map<string, number>();
    for (const section of timelineSections) {
      const key = (section.label || section.section).trim().toLowerCase();
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }

    const indexes = new Map<string, number>();
    return timelineSections.map((section) => {
      const rawLabel = prettifySectionLabel(section.label || section.section);
      const key = rawLabel.toLowerCase();
      const index = (indexes.get(key) ?? 0) + 1;
      indexes.set(key, index);
      const total = totals.get(key) ?? 1;
      return {
        section: section.section,
        rawLabel,
        label: total > 1 ? `${rawLabel} ${index}` : rawLabel,
        start: section.start,
        end: section.end,
        index,
        total,
      };
    });
  })();

  $: viewportWindow = 1 / zoomLevel;
  $: if (followPlayhead) {
    const maxViewportStart = Math.max(0, 1 - viewportWindow);
    const playheadNorm = progress / 100;
    const backstop = followViewportStart + viewportWindow * followViewportBackstopRatio;
    const lead = followViewportStart + viewportWindow * followViewportLeadRatio;
    if (
      viewportWindow >= 1 ||
      followViewportStart < 0 ||
      followViewportStart > maxViewportStart ||
      playheadNorm < backstop ||
      playheadNorm > lead
    ) {
      followViewportStart = clamp(
        playheadNorm - viewportWindow * followViewportSnapRatio,
        0,
        maxViewportStart,
      );
    }
  }
  $: viewportStart = followPlayhead
    ? followViewportStart
    : clamp(manualViewportStart, 0, 1 - viewportWindow);
  $: viewportEnd = viewportStart + viewportWindow;
  $: playheadPosition = clamp(
    ((progress / 100 - viewportStart) / viewportWindow) * 100,
    0,
    100,
  );
  $: playheadLabelOffsetPx =
    playheadPosition < 4 ? 2 : playheadPosition > 96 ? -44 : -18;
  $: playheadNibOffsetPx =
    playheadPosition < 2 ? -1 : playheadPosition > 98 ? -10 : -5;

  $: scrubMin = viewportStart * safeDuration;
  $: scrubMax = Math.max(scrubMin + 0.01, viewportEnd * safeDuration);
  $: scrubValue = clamp(currentTime, scrubMin, scrubMax);

  $: absoluteMarkerPositions = timelineSections.map((section) =>
    (section.start / safeDuration) * 100,
  );

  $: markerTags = absoluteMarkerPositions
    .map((position, index) => {
      const local = ((position / 100 - viewportStart) / viewportWindow) * 100;
      return {
        position: local,
        tag: markerTagAlphabet[index] ?? `${index + 1}`,
        tone:
          index % 3 === 0
            ? "bg-primary-500 text-surface-950 border-primary-300"
            : index % 3 === 1
              ? "bg-surface-200 text-surface-950 border-surface-100"
              : "bg-primary-300 text-surface-950 border-primary-200",
      };
    })
    .filter((entry) => entry.position >= 0 && entry.position <= 100);

  $: ({
    authoritative: authoritativeOnsetMarkers,
    liveFallback: _ignoredLiveFallback,
    countedDebug: _ignoredCountedDebug
  } = buildTimelineOnsetLanes({
    authoritative: $audioOnsets,
    liveFallback: [],
    countedDebug: [],
    durationSeconds: safeDuration,
    viewportStart,
    viewportWindow,
  }));

  $: sectionBands = timelineSections
    .map((section) => {
      const startPercent = toLocalPercent(
        section.start / safeDuration,
        viewportStart,
        viewportWindow,
      );
      const endPercent = toLocalPercent(
        section.end / safeDuration,
        viewportStart,
        viewportWindow,
      );
      return {
        section: section.section,
        label: section.label,
        energy: section.energy,
        left: clampValue(startPercent, 0, 100),
        width: clampValue(endPercent - startPercent, 0, 100),
      };
    })
    .filter((band) => band.width > 0.2);

  $: waveformMinValues = $waveformOverview?.minValues ?? [];
  $: waveformMaxValues = $waveformOverview?.maxValues ?? [];
  $: waveformPath = buildWaveformViewportPath(
    waveformMinValues,
    waveformMaxValues,
    1000,
    100,
    viewportStart,
    viewportEnd,
    1600,
  );

  $: normalizedAutomationBounds = normalizeAutomationBounds($automationBounds);
  $: speedMinBound = normalizedAutomationBounds.speedMin;
  $: speedMaxBound = normalizedAutomationBounds.speedMax;
  $: stutterMinBound = normalizedAutomationBounds.stutterMin;
  $: stutterMaxBound = normalizedAutomationBounds.stutterMax;
  $: displaySpeedPointsData = speedPoints.map((point) => ({
    x: point.x,
    y: mapRangeToNormalized(
      mapNormalizedToRange(point.y, speedMinBound, speedMaxBound),
      speedDomainMin,
      speedDomainMax,
    ),
  }));

  $: speedRampPaths = buildViewportAutomationPaths(
    displaySpeedPointsData,
    speedInterpolation,
    1000,
    100,
    viewportStart,
    viewportEnd,
  );
  $: speedNeutralDisplayNorm = mapRangeToNormalized(
    1,
    speedDomainMin,
    speedDomainMax,
  );
  $: timelineBpm = Math.max(20, Math.min(300, $tempoState.bpm || 120));
  $: visibleSpeedPoints = speedPresetId === "manual"
    ? clipPointsToViewport(
        displaySpeedPointsData,
        viewportStart,
        viewportEnd,
      )
    : [];

  $: essentiaPreset = createEssentiaPreset();
  $: essentiaStutterPreset = essentiaPreset
    ? {
        id: essentiaPreset.id,
        name: essentiaPreset.name,
        points: essentiaPreset.stutterPoints,
        interpolation: essentiaPreset.stutterInterpolation,
      }
    : null;
  $: essentiaSpeedPreset = essentiaPreset
    ? {
        id: essentiaPreset.id,
        name: essentiaPreset.name,
        points: essentiaPreset.speedPoints,
        interpolation: essentiaPreset.speedInterpolation,
      }
    : null;
  $: essentiaPunchSpeedPresets = buildEssentiaPunchSpeedPresets({
    full: $essentiaAnalysis.full,
    durationSeconds: safeDuration,
    bpm: timelineBpm,
    speedMinBound,
    speedMaxBound,
    phaseMultiplier: speedPhaseMultiplier,
  });
  $: generatedSpeedPresets = [
    ...essentiaPunchSpeedPresets,
    ...buildSpeedLanePresets(
      safeDuration,
      timelineBpm,
      speedMinBound,
      speedMaxBound,
      speedPhaseMultiplier,
    ),
    ...(essentiaSpeedPreset ? [essentiaSpeedPreset] : []),
  ];
  $: availableSpeedPresets = [
    {
      id: "manual",
      name: "Manual",
      points: speedPoints,
      interpolation: speedInterpolation,
    },
    ...generatedSpeedPresets,
  ];
  $: analysisPresetKey = String($essentiaAnalysis.updatedAtMs ?? "");
  $: if (analysisPresetKey && analysisPresetKey !== lastAppliedPresetKey) {
    lastAppliedPresetKey = analysisPresetKey;
    if (essentiaPreset) {
      stutterPoints = essentiaPreset.stutterPoints.map((point) => ({ ...point }));
      speedPoints = essentiaPreset.speedPoints.map((point) => ({ ...point }));
      stutterInterpolation = essentiaPreset.stutterInterpolation;
      speedInterpolation = essentiaPreset.speedInterpolation;
      stutterPresetId = essentiaPreset.id;
      speedPresetId = essentiaPreset.id;
    }
  }
  $: speedPresetRefreshKey = [
    speedPresetId,
    speedPhaseMultiplier,
    timelineBpm.toFixed(2),
    safeDuration.toFixed(3),
    analysisPresetKey,
  ].join("|");
  $: if (
    speedPresetId !== "manual" &&
    speedPresetRefreshKey !== lastSpeedPresetRefreshKey
  ) {
    const selectedSpeedPreset = generatedSpeedPresets.find(
      (preset) => preset.id === speedPresetId,
    );
    if (selectedSpeedPreset) {
      lastSpeedPresetRefreshKey = speedPresetRefreshKey;
      speedPoints = selectedSpeedPreset.points.map((point) => ({ ...point }));
      speedInterpolation = selectedSpeedPreset.interpolation;
    }
  }

  $: normalizedPlayhead = clampValue(currentTime / safeDuration, 0, 1);
  $: currentSpeedValue = evaluateCurveY(
    speedPoints,
    speedInterpolation,
    normalizedPlayhead,
  );
  $: waveformLaneActive = laneSoloState === null
    ? !laneMuteState.waveform
    : laneSoloState === "waveform";
  $: stutterLaneActive = false;
  $: speedLaneActive = laneSoloState === null
    ? !laneMuteState.speed
    : laneSoloState === "speed";
  $: neutralSpeedNorm = mapRangeToNormalized(1, speedMinBound, speedMaxBound);
  $: effectiveSpeedAutomationValue = speedLaneActive
    ? currentSpeedValue
    : neutralSpeedNorm;
  $: effectiveStutterAutomationValue = 0;
  $: currentSpeedRate = mapNormalizedToRange(
    effectiveSpeedAutomationValue,
    speedMinBound,
    speedMaxBound,
  );
  $: currentStutterAmount = mapNormalizedToRange(
    effectiveStutterAutomationValue,
    stutterMinBound,
    stutterMaxBound,
  );
  $: if (
    Math.abs(effectiveSpeedAutomationValue - lastAutomationSpeed) > 0.002 ||
    Math.abs(effectiveStutterAutomationValue - lastAutomationStutter) > 0.002
  ) {
    lastAutomationSpeed = effectiveSpeedAutomationValue;
    lastAutomationStutter = effectiveStutterAutomationValue;
    automationRuntime.set({
      speed: effectiveSpeedAutomationValue,
      stutter: effectiveStutterAutomationValue,
    });
  }
</script>

<div class="h-full flex flex-col font-sans p-1">
  <div class="flex-none flex justify-between items-center mb-1 overflow-hidden gap-2">
    <div class="flex items-center gap-2 min-w-0">
      <h3
        class="text-[0.65rem] font-bold uppercase tracking-widest text-surface-400 m-0"
      >
        Master Timeline
      </h3>
      <div
        class="font-mono text-[0.6rem] text-surface-300 bg-surface-950 px-1 border border-surface-800 rounded-sm"
      >
        {formatClock(currentTime)} / {formatClock(duration)}
      </div>
      <div
        class="font-mono text-[0.55rem] text-surface-400 bg-surface-950 px-1 border border-surface-800 rounded-sm truncate"
      >
        {$waveformOverview
          ? `${$waveformOverview.sourceName} • ${$waveformOverview.channelCount}ch @ ${$waveformOverview.sampleRate}Hz`
          : "No WAV waveform loaded"}
      </div>
    </div>

    <div class="flex gap-1 items-center shrink-0">
      <div
        class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-x-auto max-w-[36rem] scrollbar-thin scrollbar-track-surface-950 scrollbar-thumb-surface-700"
      >
        {#if sectionButtonItems.length}
          {#each sectionButtonItems as sectionItem}
            <button
              class="px-2 py-1 text-[0.52rem] font-bold uppercase tracking-tighter border-r border-surface-800 last:border-0 leading-none {$activeSection ===
              sectionItem.section
                ? 'bg-primary-500 text-surface-950'
                : 'text-surface-400 hover:bg-surface-800'}"
              aria-pressed={$activeSection === sectionItem.section}
              on:click={() => seekToSection(sectionItem.section)}
              title={`${sectionItem.rawLabel} ${sectionItem.total > 1 ? `${sectionItem.index}/${sectionItem.total} • ` : ""}${formatClock(sectionItem.start)} - ${formatClock(sectionItem.end)}`}
            >
              <span class="block">{sectionItem.label}</span>
              <span class="block opacity-70 text-[0.46rem] mt-0.5">
                {formatClock(sectionItem.start)}
              </span>
            </button>
          {/each}
        {:else}
          <div class="px-2 py-1 text-[0.52rem] uppercase tracking-wider text-surface-500">
            No detected sections
          </div>
        {/if}
      </div>

      <div
        class="flex gap-0.5 bg-surface-950 rounded-sm border border-surface-800 overflow-hidden"
      >
        <button
          class="px-2 py-0.5 text-[0.55rem] font-bold uppercase transition-colors {autoSwitchEnabled
            ? 'bg-primary-500/20 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          aria-pressed={autoSwitchEnabled}
          on:click={onToggleAutoSwitch}
        >
          {autoSwitchEnabled ? "Auto On" : "Auto Off"}
        </button>
        <button
          class="px-2 py-0.5 text-[0.55rem] uppercase border-l border-surface-800 font-bold transition-colors {quantizeMode ===
          'beat'
            ? 'bg-surface-700 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          aria-pressed={quantizeMode === "beat"}
          on:click={() => onSetQuantizeMode("beat")}>Beat</button
        >
        <button
          class="px-2 py-0.5 text-[0.55rem] uppercase border-l border-surface-800 font-bold transition-colors {quantizeMode ===
          'bar'
            ? 'bg-surface-700 text-primary-400'
            : 'text-surface-500 hover:bg-surface-800'}"
          aria-pressed={quantizeMode === "bar"}
          on:click={() => onSetQuantizeMode("bar")}>Bar</button
        >
      </div>

      <div class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden">
        <button class="px-1.5 py-0.5 text-[0.55rem] text-surface-300 hover:bg-surface-800" on:click={zoomOut}>-</button>
        <button class="px-2 py-0.5 text-[0.55rem] text-primary-300 border-x border-surface-800" on:click={() => setZoom(1)}>x{zoomLevel}</button>
        <button class="px-1.5 py-0.5 text-[0.55rem] text-surface-300 hover:bg-surface-800" on:click={zoomIn}>+</button>
      </div>

      <div class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden">
        <button class="px-1.5 py-0.5 text-[0.55rem] text-surface-300 hover:bg-surface-800" on:click={() => panViewport(-1)}>◀</button>
        <button
          class="px-2 py-0.5 text-[0.55rem] border-x border-surface-800 {followPlayhead
            ? 'text-primary-300 bg-primary-500/10'
            : 'text-surface-400'}"
          on:click={() => setFollowPlayheadEnabled(!followPlayhead)}
        >
          Follow
        </button>
        <button class="px-1.5 py-0.5 text-[0.55rem] text-surface-300 hover:bg-surface-800" on:click={() => panViewport(1)}>▶</button>
      </div>

      <div class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden font-mono">
        <span class="px-2 py-0.5 text-[0.52rem] text-surface-300 border-r border-surface-800">
          SPD {currentSpeedRate.toFixed(2)}x{speedLaneActive
            ? ""
            : " M"}
        </span>
        <span class="px-2 py-0.5 text-[0.52rem] text-surface-300">
          STT {(currentStutterAmount * 100).toFixed(0)}%{stutterLaneActive
            ? ""
            : " M"}
        </span>
      </div>

      {#if currentSection}
        <div class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden font-mono">
          <span class="px-2 py-0.5 text-[0.52rem] text-primary-300 border-r border-surface-800">
            {prettifySectionLabel(currentSection.label)}
          </span>
          <span class="px-2 py-0.5 text-[0.52rem] text-surface-300">
            {formatClock(currentSection.start)}-{formatClock(currentSection.end)}
          </span>
        </div>
      {/if}

      <div class="hidden xl:block text-[0.5rem] text-surface-500 font-mono">
        Scroll: Zoom · Shift+Scroll: Pan · Arrows: Nudge
      </div>
    </div>
  </div>

  <div
    on:wheel={handleTimelineWheel}
    class="flex-1 flex flex-col relative bg-surface-950 border border-surface-800 rounded-sm min-h-0 overflow-hidden text-[0.6rem] font-mono select-none"
  >
    <div
      class="absolute top-0 bottom-0 right-0 z-10 pointer-events-none"
      style={`left:${laneLabelWidthPx}px`}
    >
      <div
        class="absolute top-0 bottom-0 border-l-2 border-primary-500 shadow-[0_0_14px_rgba(245,158,11,0.75)] z-30"
        style={`left:${playheadPosition}%`}
      >
        <div
          class="absolute top-0 px-1.5 h-4 flex items-center rounded-[2px] border border-primary-300 bg-primary-500 text-surface-950 text-[0.52rem] font-bold"
          style={`margin-left:${playheadLabelOffsetPx}px`}
        >
          {formatClockWithCentis(currentTime)}
        </div>
        <div
          class="absolute top-4 w-[11px] h-2 bg-primary-500 clip-path-[polygon(0_0,100%_0,50%_100%)]"
          style={`margin-left:${playheadNibOffsetPx}px`}
        ></div>
        <div
          class="absolute bottom-0 -ml-[3px] w-[7px] h-[7px] rounded-full bg-primary-300 shadow-[0_0_10px_rgba(245,158,11,0.85)]"
        ></div>
      </div>

      {#each sectionBands as band}
        <div
          class="absolute top-0 bottom-0 pointer-events-none border-r border-primary-500/15 {band.section ===
          $activeSection
            ? 'bg-primary-500/14'
            : 'bg-primary-500/6'}"
          style={`left:${band.left}%;width:${band.width}%;opacity:${0.22 + band.energy * 0.33}`}
        ></div>
      {/each}

      {#each markerTags as marker}
        <div
          class="absolute top-0 bottom-0 w-[1px] bg-primary-500/15 border-l border-primary-400/25 border-dashed"
          style={`left:${marker.position}%`}
        ></div>
        <div
          class={`absolute top-0 -ml-1.5 h-4 min-w-4 px-[2px] flex items-center justify-center rounded-[2px] text-[0.52rem] font-black border ${marker.tone}`}
          style={`left:${marker.position}%`}
        >
          {marker.tag}
        </div>
      {/each}

      {#each Array.from({ length: 33 }) as _, index}
        <div
          class="absolute top-0 bottom-0 w-[1px] bg-surface-100/8"
          style={`left:${(index / 32) * 100}%`}
        ></div>
      {/each}
    </div>

    <input
      aria-label="Timeline scrub position"
      type="range"
      min={scrubMin}
      max={scrubMax}
      step="0.01"
      value={scrubValue}
      on:input={scrub}
      on:keydown={handleTimelineKeydown}
      class="absolute top-0 bottom-0 right-0 w-auto h-full opacity-0 cursor-ew-resize z-30 m-0"
      style={`left:${laneLabelWidthPx}px`}
    />

    <div
      class="flex-[2_2_0%] min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 group {waveformLaneActive
        ? ''
        : 'opacity-45'}"
    >
      <div
        class="w-[110px] flex-none bg-surface-900 border-r border-surface-800 flex flex-col justify-center gap-1 px-2 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-300 uppercase font-bold tracking-widest text-primary-300/85"
          >A1 Waveform</span
        >
        <div class="flex gap-1">
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneSoloState ===
            'waveform'
              ? 'border-primary-500 text-primary-300 bg-primary-500/15'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Solo waveform lane"
            aria-pressed={laneSoloState === "waveform"}
            on:click={() => toggleLaneSolo("waveform")}>S</button
          >
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneMuteState.waveform
              ? 'border-error-500 text-error-400 bg-error-500/10'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Mute waveform lane"
            aria-pressed={laneMuteState.waveform}
            on:click={() => toggleLaneMute("waveform")}>M</button
          >
        </div>
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950">
        <div
          class="absolute inset-0 pointer-events-none opacity-40"
          style="background-image: linear-gradient(to right, rgba(245,158,11,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(245,158,11,0.05) 1px, transparent 1px); background-size: 18px 18px;"
        ></div>
        <div
          class="absolute inset-x-0 top-1/2 h-[1px] bg-primary-300/25 -translate-y-1/2 pointer-events-none z-0"
        ></div>
        <div class="absolute inset-0 flex items-center justify-center z-10 opacity-95">
          <svg
            preserveAspectRatio="none"
            viewBox="0 0 1000 100"
            class="w-full h-[92%] block"
            aria-hidden="true"
          >
            <defs>
              <linearGradient id="waveFillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" stop-color="#ffd59c" stop-opacity="0.95" />
                <stop offset="46%" stop-color="#f59e0b" stop-opacity="0.86" />
                <stop offset="100%" stop-color="#7a3e07" stop-opacity="0.88" />
              </linearGradient>
              <linearGradient id="waveStrokeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stop-color="#ffe0b2" />
                <stop offset="50%" stop-color="#fbbf24" />
                <stop offset="100%" stop-color="#fcd34d" />
              </linearGradient>
            </defs>
            <path
              d={waveformPath}
              fill="url(#waveFillGradient)"
              stroke="url(#waveStrokeGradient)"
              stroke-width="0.6"
              stroke-linejoin="round"
            />
            <path
              d={waveformPath}
              fill="none"
              stroke="#ffe8c8"
              stroke-opacity="0.38"
              stroke-width="0.3"
              stroke-linejoin="round"
            />
          </svg>
        </div>
        {#each authoritativeOnsetMarkers as marker}
          <div
            class="absolute top-0 bottom-0 z-20 w-[1px] bg-lime-300/65"
            style={`left:${marker.position}%`}
            title={marker.label}
          ></div>
        {/each}
        <div
          class="absolute left-0 right-0 top-[18%] z-10 border-t border-primary-300/40 border-dashed pointer-events-none"
          title="Approximate onset threshold guide"
        ></div>
        {#if !$waveformOverview}
          <div
            class="absolute inset-0 flex items-center justify-center text-[0.55rem] text-surface-500 uppercase tracking-widest"
          >
            Load a WAV file in Audio Reactive Analyzer to visualize waveform
          </div>
        {/if}
        {#if !waveformLaneActive}
          <div
            class="absolute inset-0 flex items-center justify-center text-[0.55rem] text-surface-400 uppercase tracking-widest bg-surface-950/70"
          >
            Waveform Lane Muted
          </div>
        {/if}
      </div>
    </div>

    <div class="flex-[2_2_0%] min-h-0 flex items-stretch bg-surface-900 {speedLaneActive
      ? ''
      : 'opacity-45'}">
      <div
        class="w-[110px] flex-none bg-surface-900 border-r border-surface-800 flex flex-col justify-center gap-1 px-2 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-300 uppercase font-bold tracking-widest"
          >SPEED</span
        >
        <span class="text-[0.5rem] text-surface-500">Ramp</span>
        <div class="flex gap-1">
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneSoloState ===
            'speed'
              ? 'border-primary-500 text-primary-300 bg-primary-500/15'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Solo speed lane"
            aria-pressed={laneSoloState === "speed"}
            on:click={() => toggleLaneSolo("speed")}>S</button
          >
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneMuteState.speed
              ? 'border-error-500 text-error-400 bg-error-500/10'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Mute speed lane"
            aria-pressed={laneMuteState.speed}
            on:click={() => toggleLaneMute("speed")}>M</button
          >
        </div>
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950" bind:this={speedEditorEl}>
        <div
          class="absolute inset-0 pointer-events-none opacity-35"
          style="background-image: linear-gradient(to right, rgba(251,191,36,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(251,191,36,0.05) 1px, transparent 1px); background-size: 22px 18px;"
        ></div>
        <div
          class="absolute inset-x-0 z-0 border-t border-dashed border-primary-300/35 pointer-events-none"
          style={`top:${(1 - speedNeutralDisplayNorm) * 100}%`}
        ></div>
        <div class="absolute left-2 top-1 z-10 pointer-events-none rounded-sm bg-surface-950/80 px-1 py-[1px] text-[0.52rem] font-mono text-surface-300">
          {speedMaxBound.toFixed(2)}x
        </div>
        <div
          class="absolute left-2 z-10 pointer-events-none rounded-sm bg-surface-950/80 px-1 py-[1px] text-[0.5rem] font-mono text-primary-200"
          style={`top:calc(${(1 - speedNeutralDisplayNorm) * 100}% - 10px);`}
        >
          1.00x
        </div>
        <div class="absolute bottom-1 left-2 z-10 pointer-events-none rounded-sm bg-surface-950/80 px-1 py-[1px] text-[0.52rem] font-mono text-surface-400">
          {speedMinBound.toFixed(2)}x
        </div>
        <div class="absolute top-1 right-1 z-20 flex gap-1 items-center">
          <select
            bind:value={speedPresetId}
            on:change={(event) =>
              applyPreset(
                (event.currentTarget as HTMLSelectElement).value,
                "speed",
              )}
            disabled={!speedLaneActive}
            class="h-5 bg-surface-900 border border-surface-700 text-[0.52rem] text-surface-300 rounded-sm px-1"
          >
            {#each availableSpeedPresets as preset}
              <option value={preset.id}>{preset.name}</option>
            {/each}
          </select>
          <select
            bind:value={speedPhaseMultiplier}
            disabled={!speedLaneActive}
            class="h-5 bg-surface-900 border border-surface-700 text-[0.52rem] text-surface-300 rounded-sm px-1"
            title="Anchor frequency"
            aria-label="Preset anchor frequency"
          >
            {#each speedPhaseOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          <select
            bind:value={speedInterpolation}
            on:change={() => (speedPresetId = "manual")}
            disabled={!speedLaneActive}
            class="h-5 bg-surface-900 border border-surface-700 text-[0.52rem] text-surface-300 rounded-sm px-1"
          >
            <option value="linear">linear</option>
            <option value="smoothstep">smooth</option>
            <option value="ease_in">ease in</option>
            <option value="ease_out">ease out</option>
            <option value="step">step</option>
          </select>
          <button
            class="h-5 px-1.5 text-[0.52rem] border border-primary-500 text-primary-300 bg-primary-500/10 rounded-sm disabled:opacity-40"
            disabled={!speedLaneActive}
            on:click={resetSpeed}>Reset</button
          >
        </div>

        <svg
          preserveAspectRatio="none"
          viewBox="0 0 1000 100"
          class="w-full h-full absolute inset-0"
        >
          <defs>
            <linearGradient id="speedFillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.46" />
              <stop offset="58%" stop-color="#f59e0b" stop-opacity="0.17" />
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <path d={speedRampPaths.fill} fill="url(#speedFillGradient)" />
          <path
            d={speedRampPaths.line}
            fill="none"
            stroke="#f97316"
            stroke-opacity="0.16"
            stroke-width="1.6"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <path
            d={speedRampPaths.line}
            fill="none"
            stroke="#fbbf24"
            stroke-width="0.9"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <path
            d={speedRampPaths.line}
            fill="none"
            stroke="#ffedd5"
            stroke-opacity="0.5"
            stroke-width="0.28"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>

        {#if speedLaneActive}
          {#each visibleSpeedPoints as entry}
            <button
              aria-label={`Adjust speed control point ${entry.index + 1}`}
              class="absolute z-20 h-[6px] w-[6px] rounded-full border border-primary-200/80 bg-primary-400 hover:scale-110"
              style={`left:calc(${entry.localPercent}% - 3px); top:calc(${(1 - entry.point.y) * 100}% - 3px);`}
              on:mousedown={(event) => startCurveDrag("speed", entry.index, event)}
            ></button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

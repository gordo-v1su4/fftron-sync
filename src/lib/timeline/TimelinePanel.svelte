<script lang="ts">
  import { onMount } from "svelte";
  import {
    activeSection,
    automationRuntime,
    essentiaAnalysis,
    markers,
    waveformOverview,
  } from "$lib/stores/runtime";
  import { buildWaveformPath } from "$lib/audio/wav";

  export let duration = 0;
  export let currentTime = 0;
  export let onSeek: (time: number) => void = () => {};
  export let autoSwitchEnabled = false;
  export let quantizeMode: "beat" | "bar" = "beat";
  export let onToggleAutoSwitch: () => void = () => {};
  export let onSetQuantizeMode: (mode: "beat" | "bar") => void = () => {};

  type InterpolationMode =
    | "linear"
    | "smoothstep"
    | "ease_in"
    | "ease_out"
    | "step";

  interface CurvePoint {
    x: number;
    y: number;
  }

  interface DragState {
    track: "stutter" | "speed";
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

  type TimelineLaneId = "clips" | "waveform" | "stutter" | "speed";

  const fallbackSections = ["intro", "verse-a", "chorus-a", "bridge", "outro"];
  const markerTagAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const zoomSteps = [1, 2, 4, 8, 16];
  const neutralAutomationSpeed = (1 - 0.45) / 1.75;

  let zoomLevel = 1;
  let followPlayhead = true;
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

  let speedPoints: CurvePoint[] = [
    { x: 0, y: 0.08 },
    { x: 0.2, y: 0.82 },
    { x: 0.24, y: 0.06 },
    { x: 0.48, y: 0.9 },
    { x: 0.52, y: 0.05 },
    { x: 0.76, y: 0.86 },
    { x: 0.8, y: 0.07 },
    { x: 1, y: 0.88 },
  ];
  let stutterPresetId = "manual";
  let speedPresetId = "manual";
  let lastAppliedPresetKey = "";
  let lastAutomationSpeed = 0.5;
  let lastAutomationStutter = 0;
  let laneMuteState: Record<TimelineLaneId, boolean> = {
    clips: false,
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
  }> = fallbackSections.map((section, index) => ({
    section,
    label: section,
    rawLabel: section,
    start: index,
    end: index + 1,
    index: 1,
    total: 1,
  }));
  let sectionBands: Array<{
    section: string;
    label: string;
    energy: number;
    left: number;
    width: number;
  }> = [];
  let availablePresets: AutomationPreset[] = [];
  let essentiaPreset: AutomationPreset | null = null;
  let visibleStutterPoints: Array<{
    index: number;
    point: CurvePoint;
    localPercent: number;
  }> = [];
  let visibleSpeedPoints: Array<{
    index: number;
    point: CurvePoint;
    localPercent: number;
  }> = [];
  let currentSpeedValue = 0.5;
  let currentStutterValue = 0;

  let stutterEditorEl: HTMLDivElement | null = null;
  let speedEditorEl: HTMLDivElement | null = null;
  let activeDrag: DragState | null = null;

  const clamp = (value: number, min: number, max: number): number =>
    Math.max(min, Math.min(max, value));

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

  const buildViewportAutomationPaths = (
    points: CurvePoint[],
    mode: InterpolationMode,
    width: number,
    height: number,
    viewportStartNorm: number,
    viewportEndNorm: number,
  ): { line: string; fill: string } => {
    const viewportSpan = Math.max(0.0001, viewportEndNorm - viewportStartNorm);
    const samples = 240;
    let line = "";

    for (let index = 0; index <= samples; index += 1) {
      const localNorm = index / samples;
      const globalNorm = viewportStartNorm + localNorm * viewportSpan;
      const yNorm = evaluateCurveY(points, mode, globalNorm);
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
  };

  const setZoomAround = (nextZoom: number, anchorRatio: number) => {
    const clamped = clamp(nextZoom, zoomSteps[0], zoomSteps[zoomSteps.length - 1]);
    const currentWindow = 1 / zoomLevel;
    const anchor = clamp(anchorRatio, 0, 1);
    const viewportBaseStart = followPlayhead
      ? clamp(progress / 100 - currentWindow / 2, 0, 1 - currentWindow)
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
      followPlayhead = !followPlayhead;
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

  const startCurveDrag = (
    track: "stutter" | "speed",
    index: number,
    event: MouseEvent,
  ) => {
    event.preventDefault();
    activeDrag = { track, index };
  };

  const applyDragUpdate = (event: MouseEvent) => {
    if (!activeDrag) return;

    const container =
      activeDrag.track === "stutter" ? stutterEditorEl : speedEditorEl;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const viewportSpan = Math.max(0.0001, viewportEnd - viewportStart);
    const localXNorm = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const xNormRaw = clamp(viewportStart + localXNorm * viewportSpan, 0, 1);
    const yNorm = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1);

    const points =
      activeDrag.track === "stutter"
        ? [...stutterPoints]
        : [...speedPoints];

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

    if (activeDrag.track === "stutter") {
      stutterPoints = points;
      stutterPresetId = "manual";
    } else {
      speedPoints = points;
      speedPresetId = "manual";
    }
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
    speedPoints = [
      { x: 0, y: 0.08 },
      { x: 0.2, y: 0.82 },
      { x: 0.24, y: 0.06 },
      { x: 0.48, y: 0.9 },
      { x: 0.52, y: 0.05 },
      { x: 0.76, y: 0.86 },
      { x: 0.8, y: 0.07 },
      { x: 1, y: 0.88 },
    ];
  };

  const applyPreset = (presetId: string, track: "stutter" | "speed") => {
    const preset = availablePresets.find((entry) => entry.id === presetId);
    if (!preset) return;

    if (track === "stutter") {
      stutterPoints = preset.stutterPoints.map((point) => ({ ...point }));
      stutterInterpolation = preset.stutterInterpolation;
      stutterPresetId = preset.id;
    } else {
      speedPoints = preset.speedPoints.map((point) => ({ ...point }));
      speedInterpolation = preset.speedInterpolation;
      speedPresetId = preset.id;
    }
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
        const start = typeof startRaw === "number" ? startRaw : null;
        const end = typeof endRaw === "number" ? endRaw : null;
        const energy = typeof energyRaw === "number" ? energyRaw : 0.5;
        return {
          id: marker.id || `mk-${index + 1}`,
          section: marker.section,
          label: marker.section,
          start,
          end,
          energy,
        };
      })
      .filter((entry) => entry.start !== null)
      .sort((a, b) => (a.start ?? 0) - (b.start ?? 0));

    if (!fromMarkers.length) {
      return fallbackSections.map((name, index) => {
        const start = (index / fallbackSections.length) * safeDurationSeconds;
        const end = ((index + 1) / fallbackSections.length) * safeDurationSeconds;
        return {
          id: `fallback-${name}`,
          section: name,
          label: name,
          start,
          end,
          energy: 0.5,
        };
      });
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
  $: centeredViewportStart = clamp(
    progress / 100 - viewportWindow / 2,
    0,
    1 - viewportWindow,
  );
  $: viewportStart = followPlayhead
    ? centeredViewportStart
    : clamp(manualViewportStart, 0, 1 - viewportWindow);
  $: viewportEnd = viewportStart + viewportWindow;
  $: playheadPosition = clamp(
    ((progress / 100 - viewportStart) / viewportWindow) * 100,
    0,
    100,
  );

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
        left: clamp(startPercent, 0, 100),
        width: clamp(endPercent - startPercent, 0, 100),
      };
    })
    .filter((band) => band.width > 0.2);

  $: peaks = $waveformOverview?.peaks ?? [];
  $: peakStartIndex = Math.floor(viewportStart * peaks.length);
  $: peakEndIndex = Math.max(
    peakStartIndex + 8,
    Math.ceil(viewportEnd * peaks.length),
  );
  $: visiblePeaks = peaks.slice(peakStartIndex, peakEndIndex);
  $: waveformPath = buildWaveformPath(visiblePeaks, 1000, 100);

  $: stutterPaths = buildViewportAutomationPaths(
    stutterPoints,
    stutterInterpolation,
    1000,
    100,
    viewportStart,
    viewportEnd,
  );
  $: speedRampPaths = buildViewportAutomationPaths(
    speedPoints,
    speedInterpolation,
    1000,
    100,
    viewportStart,
    viewportEnd,
  );
  $: visibleStutterPoints = clipPointsToViewport(
    stutterPoints,
    viewportStart,
    viewportEnd,
  );
  $: visibleSpeedPoints = clipPointsToViewport(speedPoints, viewportStart, viewportEnd);

  $: essentiaPreset = createEssentiaPreset();
  $: availablePresets = [
    ...createBuiltInPresets(),
    ...(essentiaPreset ? [essentiaPreset] : []),
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

  $: normalizedPlayhead = clamp(currentTime / safeDuration, 0, 1);
  $: currentSpeedValue = evaluateCurveY(
    speedPoints,
    speedInterpolation,
    normalizedPlayhead,
  );
  $: currentStutterValue = evaluateCurveY(
    stutterPoints,
    stutterInterpolation,
    normalizedPlayhead,
  );
  $: clipLaneActive = laneSoloState === null
    ? !laneMuteState.clips
    : laneSoloState === "clips";
  $: waveformLaneActive = laneSoloState === null
    ? !laneMuteState.waveform
    : laneSoloState === "waveform";
  $: stutterLaneActive = laneSoloState === null
    ? !laneMuteState.stutter
    : laneSoloState === "stutter";
  $: speedLaneActive = laneSoloState === null
    ? !laneMuteState.speed
    : laneSoloState === "speed";
  $: effectiveSpeedAutomationValue = speedLaneActive
    ? currentSpeedValue
    : neutralAutomationSpeed;
  $: effectiveStutterAutomationValue = stutterLaneActive ? currentStutterValue : 0;
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
          on:click={() => {
            followPlayhead = !followPlayhead;
          }}
        >
          Follow
        </button>
        <button class="px-1.5 py-0.5 text-[0.55rem] text-surface-300 hover:bg-surface-800" on:click={() => panViewport(1)}>▶</button>
      </div>

      <div class="flex bg-surface-950 rounded-sm border border-surface-800 overflow-hidden font-mono">
        <span class="px-2 py-0.5 text-[0.52rem] text-surface-300 border-r border-surface-800">
          SPD {(0.5 + effectiveSpeedAutomationValue * 1.6).toFixed(2)}x{speedLaneActive
            ? ""
            : " M"}
        </span>
        <span class="px-2 py-0.5 text-[0.52rem] text-surface-300">
          STT {(effectiveStutterAutomationValue * 100).toFixed(0)}%{stutterLaneActive
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
    <div class="absolute inset-0 z-10 pointer-events-none">
      <div
        class="absolute top-0 bottom-0 border-l-2 border-primary-500 shadow-[0_0_14px_rgba(245,158,11,0.75)] z-30"
        style={`left:${playheadPosition}%`}
      >
        <div
          class="absolute top-0 -ml-[18px] px-1.5 h-4 flex items-center rounded-[2px] border border-primary-300 bg-primary-500 text-surface-950 text-[0.52rem] font-bold"
        >
          {formatClockWithCentis(currentTime)}
        </div>
        <div
          class="absolute top-4 -ml-[5px] w-[11px] h-2 bg-primary-500 clip-path-[polygon(0_0,100%_0,50%_100%)]"
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
      class="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30 m-0"
    />

    <div
      class="basis-[22%] min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 group relative {clipLaneActive
        ? ''
        : 'opacity-45'}"
    >
      <div
        class="w-[110px] flex-none bg-surface-900 border-r border-surface-800 flex flex-col justify-center gap-1 px-2 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-300 uppercase font-bold tracking-widest text-primary-300/80"
          >V1 Clips</span
        >
        <div class="flex gap-1">
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneSoloState ===
            'clips'
              ? 'border-primary-500 text-primary-300 bg-primary-500/15'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Solo clips lane"
            aria-pressed={laneSoloState === "clips"}
            on:click={() => toggleLaneSolo("clips")}>S</button
          >
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneMuteState.clips
              ? 'border-error-500 text-error-400 bg-error-500/10'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Mute clips lane"
            aria-pressed={laneMuteState.clips}
            on:click={() => toggleLaneMute("clips")}>M</button
          >
        </div>
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950">
        <div class="absolute inset-y-1 mx-2 flex gap-1">
          <div
            class="h-full w-24 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CLIP_A</span>
          </div>
          <div
            class="h-full w-12 bg-surface-800 border-l border-r border-surface-700 border-t-2 border-t-primary-500 overflow-hidden flex items-center justify-center bg-primary-500/10"
          >
            <span class="text-[0.5rem] text-primary-400">CUT</span>
          </div>
          <div
            class="h-full w-32 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CLIP_B</span>
          </div>
          <div
            class="h-full w-16 bg-surface-800 border border-surface-700 rounded-sm overflow-hidden flex items-center justify-center opacity-70"
          >
            <span class="text-[0.5rem] text-surface-500">CHORUS</span>
          </div>
        </div>
      </div>
    </div>

    <div
      class="basis-[34%] min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 group {waveformLaneActive
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
        <div
          class="absolute inset-0 flex items-center justify-center px-2 z-10 opacity-95"
        >
          <svg
            preserveAspectRatio="none"
            viewBox="0 0 1000 100"
            class="w-full h-[92%]"
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

    <div class="basis-[22%] min-h-0 flex border-b border-surface-800 items-stretch bg-surface-900 {stutterLaneActive
      ? ''
      : 'opacity-45'}">
      <div
        class="w-[110px] flex-none bg-surface-900 border-r border-surface-800 flex flex-col justify-center gap-1 px-2 z-20"
      >
        <span
          class="text-[0.6rem] text-surface-300 uppercase font-bold tracking-widest"
          >STUTTER</span
        >
        <span class="text-[0.5rem] text-surface-500">Envelope Lane</span>
        <div class="flex gap-1">
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneSoloState ===
            'stutter'
              ? 'border-primary-500 text-primary-300 bg-primary-500/15'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Solo stutter lane"
            aria-pressed={laneSoloState === "stutter"}
            on:click={() => toggleLaneSolo("stutter")}>S</button
          >
          <button
            class="h-4 w-4 rounded-[2px] text-[0.5rem] font-black border {laneMuteState.stutter
              ? 'border-error-500 text-error-400 bg-error-500/10'
              : 'border-surface-700 text-surface-500 hover:bg-surface-800'}"
            aria-label="Mute stutter lane"
            aria-pressed={laneMuteState.stutter}
            on:click={() => toggleLaneMute("stutter")}>M</button
          >
        </div>
      </div>
      <div class="flex-1 relative overflow-hidden bg-surface-950 px-2" bind:this={stutterEditorEl}>
        <div class="absolute top-1 right-1 z-20 flex gap-1 items-center">
          <select
            bind:value={stutterPresetId}
            on:change={(event) =>
              applyPreset(
                (event.currentTarget as HTMLSelectElement).value,
                "stutter",
              )}
            disabled={!stutterLaneActive}
            class="h-5 bg-surface-900 border border-surface-700 text-[0.52rem] text-surface-300 rounded-sm px-1"
          >
            {#each availablePresets as preset}
              <option value={preset.id}>{preset.name}</option>
            {/each}
          </select>
          <select
            bind:value={stutterInterpolation}
            on:change={() => (stutterPresetId = "manual")}
            disabled={!stutterLaneActive}
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
            disabled={!stutterLaneActive}
            on:click={resetStutter}>Reset</button
          >
        </div>

        <svg
          preserveAspectRatio="none"
          viewBox="0 0 1000 100"
          class="w-full h-full absolute inset-0"
        >
          <defs>
            <linearGradient id="stutterFillGradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stop-color="#fbbf24" stop-opacity="0.46" />
              <stop offset="100%" stop-color="#fbbf24" stop-opacity="0.04" />
            </linearGradient>
          </defs>
          <path d={stutterPaths.fill} fill="url(#stutterFillGradient)" />
          <path
            d={stutterPaths.line}
            fill="none"
            stroke="#fcd34d"
            stroke-width="1.8"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>

        {#if stutterLaneActive}
          {#each visibleStutterPoints as entry}
            <button
              aria-label={`Adjust stutter control point ${entry.index + 1}`}
              class="absolute z-20 w-2.5 h-2.5 rounded-full border border-primary-200 bg-primary-500 hover:scale-110"
              style={`left:calc(${entry.localPercent}% - 5px); top:calc(${(1 - entry.point.y) * 100}% - 5px);`}
              on:mousedown={(event) =>
                startCurveDrag("stutter", entry.index, event)}
            ></button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="basis-[22%] min-h-0 flex items-stretch bg-surface-900 {speedLaneActive
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
      <div class="flex-1 relative overflow-hidden bg-surface-950 px-2" bind:this={speedEditorEl}>
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
            {#each availablePresets as preset}
              <option value={preset.id}>{preset.name}</option>
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
              <stop offset="0%" stop-color="#f59e0b" stop-opacity="0.38" />
              <stop offset="100%" stop-color="#f59e0b" stop-opacity="0.06" />
            </linearGradient>
          </defs>
          <path d={speedRampPaths.fill} fill="url(#speedFillGradient)" />
          <path
            d={speedRampPaths.line}
            fill="none"
            stroke="#fbbf24"
            stroke-width="1.8"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
        </svg>

        {#if speedLaneActive}
          {#each visibleSpeedPoints as entry}
            <button
              aria-label={`Adjust speed control point ${entry.index + 1}`}
              class="absolute z-20 w-2.5 h-2.5 rounded-full border border-primary-200 bg-primary-500 hover:scale-110"
              style={`left:calc(${entry.localPercent}% - 5px); top:calc(${(1 - entry.point.y) * 100}% - 5px);`}
              on:mousedown={(event) => startCurveDrag("speed", entry.index, event)}
            ></button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
</div>

export function enforceSilentVideoElement(
  element: HTMLVideoElement | null | undefined,
): void {
  if (!element) return;
  element.muted = true;
  element.defaultMuted = true;
  element.volume = 0;
}

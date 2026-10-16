// WebGPU availability gate. GraphGPU is pure WebGPU: without navigator.gpu
// (e.g. Firefox stable on Linux, which ships no WebGPU) its init() resolves
// `false` and renders nothing — a silent black canvas. Every failure here
// throws a human-readable Error so the UI can show it instead of black.

/** True when this browser exposes the WebGPU API at all. */
export function hasWebGPU(): boolean {
  if (typeof navigator === "undefined") return false;
  return (navigator as Navigator & { gpu?: unknown }).gpu != null;
}

/** Which browsers can run the 3D views (shown verbatim in the gate message). */
export const WEBGPU_BROWSERS =
  "Chrome / Edge 113+, Safari 18+ (macOS), or Firefox Nightly with dom.webgpu.enabled. " +
  "Firefox stable on Linux has no WebGPU and cannot render the 3D views.";

export function webgpuMissingError(): Error {
  return new Error(
    "WebGPU is unavailable in this browser (navigator.gpu is missing), " +
      "so the 3D graph cannot initialise. " +
      WEBGPU_BROWSERS,
  );
}

export function webgpuInitFailedError(detail: string): Error {
  return new Error(
    `WebGPU initialisation failed (${detail}). The GPU adapter or device ` +
      `request was refused — try updating GPU drivers, enabling hardware ` +
      "acceleration, or switching browser. " +
      WEBGPU_BROWSERS,
  );
}

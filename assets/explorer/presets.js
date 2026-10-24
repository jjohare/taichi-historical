// Pure: the five camera presets (design §5.4). Target (0, 0.95, 0); distance 3.3392 at 8.61° elevation.
// `top` sits 5° off the zenith because lookAt is degenerate straight down with up = +Y.
export const TARGET = [0, .95, 0];
export const PRESETS = {
  'three-quarter': [1.9, 1.45, 2.7],
  front: [0, 1.45, 3.3015],
  side: [3.3015, 1.45, 0],
  back: [0, 1.45, -3.3015],
  top: [0, 4.2765, .291],
};
export const PRESET_ORDER = ['front', 'side', 'back', 'three-quarter', 'top'];

export const presetPosition = name => (Object.hasOwn(PRESETS, name) ? [...PRESETS[name]] : null);

// Name of the preset the camera is sitting on, else 'custom'. Comparing positions (rather than listening for
// OrbitControls' change event, which also fires on programmatic updates) keeps the buttons honest.
export function detectPreset(position, tolerance = 1e-3) {
  for (const name of PRESET_ORDER) {
    if (PRESETS[name].every((v, i) => Math.abs(v - position[i]) <= tolerance)) return name;
  }
  return 'custom';
}

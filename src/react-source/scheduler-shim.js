export * from "../../../react-source/packages/scheduler/index.js";

// These two exports exist on `scheduler/unstable_mock`, but React's internal
// wrapper references them unconditionally. Rollup requires a concrete export.
export function log() {}

export function unstable_setDisableYieldValue() {}

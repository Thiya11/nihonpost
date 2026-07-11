// Framework-agnostic core — usable from any JS/TS project
export { lookup, lookupAll, configureLoader, fetchLoader, cdnLoader } from './core/lookup'
export {
  normalizePostalCode,
  isCompletePostalCode,
  formatPostalCode,
} from './core/normalize'
export { PREFECTURES } from './core/prefectures'
export type {
  JpAddress,
  Chunk,
  ChunkLoader,
  LookupOptions,
  PackedAddress,
} from './core/types'

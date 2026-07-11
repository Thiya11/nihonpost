// Vue 3 layer — import from 'nihonpost/vue'
export { usePostalCode } from './vue/usePostalCode'
export type { UsePostalCodeOptions } from './vue/usePostalCode'

// Re-export core so Vue users need only one package path
export { configureLoader, fetchLoader, lookup, lookupAll } from './core/lookup'
export { formatPostalCode, normalizePostalCode } from './core/normalize'
export type { JpAddress, ChunkLoader } from './core/types'

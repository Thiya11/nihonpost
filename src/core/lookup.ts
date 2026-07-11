import type { Chunk, ChunkLoader, JpAddress, LookupOptions, PackedAddress } from './types'
import { normalizePostalCode } from './normalize'
import { PREFECTURES } from './prefectures'

// Injected by the bundler (tsup/vitest `define`); guarded so that consuming
// the source directly without a define still works.
declare const __NIHONPOST_VERSION__: string | undefined

const VERSION =
  typeof __NIHONPOST_VERSION__ !== 'undefined' ? __NIHONPOST_VERSION__ : 'latest'

const chunkCache = new Map<string, Chunk | null>()
const inflight = new Map<string, Promise<Chunk | null>>()
// Bumped whenever caches are cleared, so loads already in flight
// cannot write stale results into the fresh cache when they settle.
let generation = 0

let configuredLoader: ChunkLoader | null = null
let cdnNoticeShown = false

/** Set the global default chunk loader (call once at app startup). */
export function configureLoader(loader: ChunkLoader): void {
  configuredLoader = loader
  generation++
  chunkCache.clear()
  inflight.clear()
}

/**
 * Loader that serves chunks from the jsDelivr CDN, pinned to the installed
 * package version — upgrading nihonpost automatically moves the pin.
 *
 *   configureLoader(cdnLoader())
 */
export function cdnLoader(): ChunkLoader {
  return fetchLoader(`https://cdn.jsdelivr.net/npm/nihonpost@${VERSION}/data`)
}

// Zero-config default: fall back to the CDN, telling the developer once.
function defaultLoader(): ChunkLoader {
  if (configuredLoader) return configuredLoader
  if (!cdnNoticeShown) {
    cdnNoticeShown = true
    console.info(
      `[nihonpost] No loader configured — fetching data from jsDelivr ` +
        `(nihonpost@${VERSION}). To self-host or work offline, call ` +
        `configureLoader(). See https://github.com/Thiya11/nihonpost#data-loading`,
    )
  }
  configuredLoader = cdnLoader()
  return configuredLoader
}

/**
 * Built-in loader that fetches chunk JSON from a base URL —
 * your own /public dir, a CDN, or GitHub Pages. No API server involved.
 *
 *   configureLoader(fetchLoader('/nihonpost-data'))
 *   // → GET /nihonpost-data/150.json
 */
export function fetchLoader(baseUrl: string): ChunkLoader {
  const base = baseUrl.replace(/\/$/, '')
  return async (prefix) => {
    const res = await fetch(`${base}/${prefix}.json`)
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`[nihonpost] chunk fetch failed: ${res.status}`)
    return (await res.json()) as Chunk
  }
}

function unpack(packed: PackedAddress): JpAddress {
  const [prefCode, city, town, cityKana, townKana] = packed
  const [prefecture, prefectureKana] = PREFECTURES[prefCode] ?? ['', '']
  return {
    prefecture,
    city,
    town,
    prefectureKana,
    cityKana,
    townKana,
    prefectureCode: prefCode,
  }
}

async function loadChunk(prefix: string, loader: ChunkLoader): Promise<Chunk | null> {
  if (chunkCache.has(prefix)) return chunkCache.get(prefix)!

  // Deduplicate concurrent requests for the same chunk
  let promise = inflight.get(prefix)
  if (!promise) {
    const gen = generation
    const p: Promise<Chunk | null> = loader(prefix)
      .then((chunk) => {
        if (gen === generation) chunkCache.set(prefix, chunk)
        return chunk
      })
      .finally(() => {
        if (inflight.get(prefix) === p) inflight.delete(prefix)
      })
    promise = p
    inflight.set(prefix, p)
  }
  return promise
}

/**
 * Look up all addresses for a postal code.
 * Some codes legitimately map to multiple municipalities (e.g. 4980000
 * spans 愛知県弥富市 and 三重県桑名郡木曽岬町), hence the array.
 *
 * Returns [] for valid-format codes with no match,
 * and null for input that isn't a 7-digit code.
 */
export async function lookupAll(
  raw: string,
  options: LookupOptions = {},
): Promise<JpAddress[] | null> {
  const code = normalizePostalCode(raw)
  if (!code) return null

  const loader = options.loader ?? defaultLoader()
  const chunk = await loadChunk(code.slice(0, 3), loader)
  const hits = chunk?.[code]
  return hits ? hits.map(unpack) : []
}

/** Convenience: the first (most common) match, or null. */
export async function lookup(
  raw: string,
  options: LookupOptions = {},
): Promise<JpAddress | null> {
  const all = await lookupAll(raw, options)
  return all?.[0] ?? null
}

/** Test hook — resets caches and loader configuration between test cases. */
export function __clearCache(): void {
  generation++
  chunkCache.clear()
  inflight.clear()
  configuredLoader = null
  cdnNoticeShown = false
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  formatPostalCode,
  isCompletePostalCode,
  normalizePostalCode,
} from '../src/core/normalize'
import { __clearCache, cdnLoader, configureLoader, lookup, lookupAll } from '../src/core/lookup'
import { usePostalCode } from '../src/vue/usePostalCode'
import type { Chunk } from '../src/core/types'

// Loader that reads fixture chunks from disk, mimicking fetchLoader semantics
const fixtureLoader = async (prefix: string): Promise<Chunk | null> => {
  try {
    const raw = readFileSync(resolve(__dirname, `fixtures/${prefix}.json`), 'utf8')
    return JSON.parse(raw) as Chunk
  } catch {
    return null
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

beforeEach(() => {
  __clearCache()
  configureLoader(fixtureLoader)
})

describe('normalizePostalCode', () => {
  it('accepts a plain 7-digit code', () => {
    expect(normalizePostalCode('1500002')).toBe('1500002')
  })

  it('strips hyphens in every variant', () => {
    for (const h of ['-', '−', '–', '—', 'ー', '‐', 'ｰ']) {
      expect(normalizePostalCode(`150${h}0002`)).toBe('1500002')
    }
  })

  it('converts full-width digits', () => {
    expect(normalizePostalCode('１５０－０００２')).toBe('1500002')
  })

  it('strips the postal mark and spaces', () => {
    expect(normalizePostalCode('〒 150-0002')).toBe('1500002')
  })

  it('rejects wrong lengths', () => {
    expect(normalizePostalCode('150000')).toBeNull()
    expect(normalizePostalCode('15000021')).toBeNull()
    expect(normalizePostalCode('')).toBeNull()
    expect(normalizePostalCode('shibuya')).toBeNull()
  })

  it('formats for display', () => {
    expect(formatPostalCode('１５００００２')).toBe('150-0002')
  })

  it('isCompletePostalCode mirrors normalization', () => {
    expect(isCompletePostalCode('〒150-0002')).toBe(true)
    expect(isCompletePostalCode('150-000')).toBe(false)
  })
})

describe('normalizePostalCode (brutal input)', () => {
  it('survives tabs, newlines, and full-width spaces inside the code', () => {
    expect(normalizePostalCode('150\t00\n02')).toBe('1500002')
    expect(normalizePostalCode('　１５０　０００２　')).toBe('1500002')
  })

  it('extracts 7 digits buried in surrounding text', () => {
    // Documented behavior: anything that cleans down to exactly 7 digits passes
    expect(normalizePostalCode('〒1500002 東京都渋谷区')).toBe('1500002')
    expect(normalizePostalCode('code: 1500002.')).toBe('1500002')
  })

  it('rejects when stray digits push the count past 7', () => {
    expect(normalizePostalCode('150-0002-1')).toBeNull()
    expect(normalizePostalCode('tel 03 1234 5678')).toBeNull()
  })

  it('does not accept non-ASCII, non-full-width digit systems', () => {
    expect(normalizePostalCode('١٥٠٠٠٠٢')).toBeNull() // Arabic-Indic
    expect(normalizePostalCode('①⑤⓪⓪⓪⓪②')).toBeNull() // circled
    expect(normalizePostalCode('一五〇〇〇〇二')).toBeNull() // kanji numerals
  })

  it('rejects punctuation-only and mark-only input', () => {
    expect(normalizePostalCode('〒')).toBeNull()
    expect(normalizePostalCode('---')).toBeNull()
    expect(normalizePostalCode('   ')).toBeNull()
  })

  it('handles every hyphen variant mixed with full-width digits', () => {
    for (const h of ['-', '−', '–', '—', 'ー', '‐', 'ｰ', '〜', '~']) {
      expect(normalizePostalCode(`１５０${h}０００２`)).toBe('1500002')
    }
  })

  it('formatPostalCode echoes unparseable input unchanged', () => {
    expect(formatPostalCode('abc')).toBe('abc')
    expect(formatPostalCode('')).toBe('')
    expect(formatPostalCode('150-0002')).toBe('150-0002') // idempotent
  })
})

describe('lookup', () => {
  it('resolves a Shibuya address with derived prefecture fields', async () => {
    const addr = await lookup('150-0002')
    expect(addr).toEqual({
      prefecture: '東京都',
      city: '渋谷区',
      town: '渋谷',
      prefectureKana: 'トウキョウト',
      cityKana: 'シブヤク',
      townKana: 'シブヤ',
      prefectureCode: 13,
    })
  })

  it('handles full-width messy input end to end', async () => {
    const addr = await lookup('〒１５０ー０００２')
    expect(addr?.town).toBe('渋谷')
  })

  it('returns all municipalities for a shared code', async () => {
    const all = await lookupAll('4980000')
    expect(all).toHaveLength(2)
    expect(all?.map((a) => a.prefecture)).toEqual(['愛知県', '三重県'])
  })

  it('returns [] for a valid-format code with no match', async () => {
    expect(await lookupAll('1509999')).toEqual([])
  })

  it('returns [] when the whole chunk is missing', async () => {
    expect(await lookupAll('9999999')).toEqual([])
  })

  it('returns null for invalid input', async () => {
    expect(await lookupAll('abc')).toBeNull()
  })

  it('caches chunks (loader called once per prefix)', async () => {
    let calls = 0
    configureLoader(async (prefix) => {
      calls++
      return fixtureLoader(prefix)
    })
    await lookup('1500002')
    await lookup('1500001')
    await lookup('1500000')
    expect(calls).toBe(1)
  })

  it('reconfiguring the loader invalidates in-flight chunk loads', async () => {
    configureLoader(async () => {
      await new Promise((r) => setTimeout(r, 30))
      return { '1500002': [[13, 'OLD', 'OLD', '', '']] } as Chunk
    })
    const stale = lookup('1500002') // starts under the old loader
    configureLoader(fixtureLoader)
    await stale // resolves late — must not poison the new loader's cache
    const addr = await lookup('1500002')
    expect(addr?.city).toBe('渋谷区')
  })
})

describe('lookup (loader edge cases)', () => {
  it('deduplicates concurrent loads of the same chunk', async () => {
    let calls = 0
    configureLoader(async (prefix) => {
      calls++
      await sleep(10)
      return fixtureLoader(prefix)
    })
    const [a, b, c] = await Promise.all([
      lookup('1500002'),
      lookup('1500001'),
      lookupAll('1500000'),
    ])
    expect(calls).toBe(1)
    expect(a?.town).toBe('渋谷')
    expect(b).not.toBeNull()
    expect(c).not.toBeNull()
  })

  it('propagates loader errors to the caller', async () => {
    configureLoader(async () => {
      throw new Error('network down')
    })
    await expect(lookup('1500002')).rejects.toThrow('network down')
  })

  it('does not cache failed loads — a retry hits the loader again', async () => {
    let attempts = 0
    configureLoader(async (prefix) => {
      attempts++
      if (attempts === 1) throw new Error('boom')
      return fixtureLoader(prefix)
    })
    await expect(lookup('1500002')).rejects.toThrow('boom')
    const addr = await lookup('1500002')
    expect(addr?.city).toBe('渋谷区')
    expect(attempts).toBe(2)
  })

  it('per-call loader option overrides the global default', async () => {
    const custom = async () =>
      ({ '1500002': [[13, 'カスタム区', 'カスタム', '', '']] }) as Chunk
    const addr = await lookup('1500002', { loader: custom })
    expect(addr?.city).toBe('カスタム区')
  })

  it('degrades gracefully on unknown prefecture codes in data', async () => {
    configureLoader(async () => ({ '1500002': [[99, '謎市', '謎町', 'ナゾシ', 'ナゾマチ']] }) as Chunk)
    const addr = await lookup('1500002')
    expect(addr?.prefecture).toBe('')
    expect(addr?.prefectureKana).toBe('')
    expect(addr?.prefectureCode).toBe(99)
    expect(addr?.city).toBe('謎市')
  })

  it('handles the all-zeros code without special-casing', async () => {
    expect(await lookupAll('0000000')).toEqual([])
  })

  it('preserves leading zeros end to end', async () => {
    const addr = await lookup('０６０-００００') // full-width Sapporo code
    expect(addr?.prefecture).toBe('北海道')
  })
})

describe('cdnLoader / zero-config default', () => {
  const pkgVersion = JSON.parse(
    readFileSync(resolve(__dirname, '../package.json'), 'utf8'),
  ).version as string

  const stubFetch = (chunk: Chunk | null) => {
    const mock = vi.fn(async (_url: string) =>
      chunk
        ? { ok: true, status: 200, json: async () => chunk }
        : { ok: false, status: 404, json: async () => null },
    )
    vi.stubGlobal('fetch', mock)
    return mock
  }

  it('cdnLoader pins jsDelivr to the installed package version', async () => {
    const chunk = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/150.json'), 'utf8'))
    const fetchMock = stubFetch(chunk)
    configureLoader(cdnLoader())
    const addr = await lookup('1500002')
    expect(addr?.city).toBe('渋谷区')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `https://cdn.jsdelivr.net/npm/nihonpost@${pkgVersion}/data/150.json`,
    )
    vi.unstubAllGlobals()
  })

  it('unconfigured lookups fall back to the CDN with a one-time notice', async () => {
    __clearCache() // wipes the loader configured in beforeEach
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const chunk = JSON.parse(readFileSync(resolve(__dirname, 'fixtures/150.json'), 'utf8'))
    const fetchMock = stubFetch(chunk)

    const addr = await lookup('1500002') // no configureLoader call anywhere
    expect(addr?.city).toBe('渋谷区')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('cdn.jsdelivr.net/npm/nihonpost@')

    await lookup('0600000') // different chunk — notice must not repeat
    expect(info).toHaveBeenCalledTimes(1)
    expect(info.mock.calls[0]?.[0]).toContain('configureLoader')

    info.mockRestore()
    vi.unstubAllGlobals()
  })

  it('configureLoader silences the CDN fallback entirely', async () => {
    __clearCache()
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    configureLoader(fixtureLoader)
    await lookup('1500002')
    expect(info).not.toHaveBeenCalled()
    info.mockRestore()
  })
})

describe('usePostalCode (Vue composable)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('auto-fills when 7 digits are entered', async () => {
    const { code, address, loading, notFound } = usePostalCode()
    code.value = '150-0002'
    await nextTick()
    await flush()
    expect(loading.value).toBe(false)
    expect(notFound.value).toBe(false)
    expect(address.value?.city).toBe('渋谷区')
  })

  it('sets notFound for unmatched codes', async () => {
    const { code, address, notFound } = usePostalCode()
    code.value = '1509999'
    await nextTick()
    await flush()
    expect(address.value).toBeNull()
    expect(notFound.value).toBe(true)
  })

  it('clears results when input becomes incomplete', async () => {
    const { code, address } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    await flush()
    expect(address.value).not.toBeNull()
    code.value = '150000'
    await nextTick()
    expect(address.value).toBeNull()
  })

  it('manual mode does not auto-search', async () => {
    const { code, address, search } = usePostalCode({ auto: false })
    code.value = '1500002'
    await nextTick()
    await flush()
    expect(address.value).toBeNull()
    await search()
    expect(address.value?.town).toBe('渋谷')
  })

  it('exposes multi-match addresses', async () => {
    const { code, addresses } = usePostalCode()
    code.value = '4980000'
    await nextTick()
    await flush()
    expect(addresses.value).toHaveLength(2)
  })

  it('in-flight result does not land after input becomes incomplete', async () => {
    configureLoader(async (prefix) => {
      await new Promise((r) => setTimeout(r, 30))
      return fixtureLoader(prefix)
    })
    const { code, address, loading } = usePostalCode()
    code.value = '1500002' // slow search fires
    await nextTick()
    code.value = '150000' // input edited to incomplete → results cleared
    await nextTick()
    await new Promise((r) => setTimeout(r, 60))
    expect(address.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('reset() cancels an in-flight search', async () => {
    configureLoader(async (prefix) => {
      await new Promise((r) => setTimeout(r, 30))
      return fixtureLoader(prefix)
    })
    const { code, address, loading, reset } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    reset()
    await new Promise((r) => setTimeout(r, 60))
    expect(address.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('reset() cancels a pending debounced search', async () => {
    const { code, address, reset } = usePostalCode({ debounce: 20 })
    code.value = '1500002'
    await nextTick()
    reset() // fires before the debounce timer
    await new Promise((r) => setTimeout(r, 60))
    expect(address.value).toBeNull()
  })

  it('clears a stale error when input becomes incomplete', async () => {
    configureLoader(async () => {
      throw new Error('network down')
    })
    const { code, error } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    await flush()
    expect(error.value).not.toBeNull()
    code.value = '150000'
    await nextTick()
    expect(error.value).toBeNull()
  })

  it('stale responses do not overwrite newer ones', async () => {
    // Slow loader for 150*, fast for 498*
    configureLoader(async (prefix) => {
      if (prefix === '150') await new Promise((r) => setTimeout(r, 30))
      return fixtureLoader(prefix)
    })
    const { code, address } = usePostalCode()
    code.value = '1500002' // slow request fires
    await nextTick()
    code.value = '4980000' // fast request supersedes it
    await nextTick()
    await new Promise((r) => setTimeout(r, 60))
    expect(address.value?.prefecture).toBe('愛知県')
  })
})

describe('usePostalCode (stress)', () => {
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('loading is true while a request is in flight, false after', async () => {
    configureLoader(async (prefix) => {
      await sleep(20)
      return fixtureLoader(prefix)
    })
    const { code, loading } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    expect(loading.value).toBe(true)
    await sleep(40)
    expect(loading.value).toBe(false)
  })

  it('debounce coalesces rapid typing into a single lookup', async () => {
    let calls = 0
    configureLoader(async (prefix) => {
      calls++
      return fixtureLoader(prefix)
    })
    const { code, address } = usePostalCode({ debounce: 20 })
    code.value = '1500001'
    await nextTick()
    code.value = '1500002'
    await nextTick()
    code.value = '4980000'
    await nextTick()
    await sleep(60)
    expect(calls).toBe(1)
    expect(address.value?.prefecture).toBe('愛知県')
  })

  it('survives found → notFound → found transitions', async () => {
    const { code, address, notFound } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    await flush()
    expect(address.value?.city).toBe('渋谷区')
    code.value = '1509999'
    await nextTick()
    await flush()
    expect(address.value).toBeNull()
    expect(notFound.value).toBe(true)
    code.value = '4980000'
    await nextTick()
    await flush()
    expect(notFound.value).toBe(false)
    expect(address.value?.prefecture).toBe('愛知県')
  })

  it('recovers cleanly after a loader error', async () => {
    configureLoader(async () => {
      throw new Error('network down')
    })
    const { code, address, error } = usePostalCode()
    code.value = '1500002'
    await nextTick()
    await flush()
    expect(error.value?.message).toBe('network down')
    expect(address.value).toBeNull()

    configureLoader(fixtureLoader)
    code.value = '4980000'
    await nextTick()
    await flush()
    expect(error.value).toBeNull()
    expect(address.value?.prefecture).toBe('愛知県')
  })

  it('manual search accepts messy input directly without touching code', async () => {
    const { code, search } = usePostalCode({ auto: false })
    const result = await search('〒１５０ー０００２')
    expect(result?.town).toBe('渋谷')
    expect(code.value).toBe('')
  })

  it('concurrent manual searches: the last call wins the state', async () => {
    configureLoader(async (prefix) => {
      if (prefix === '150') await sleep(30) // first search resolves last
      return fixtureLoader(prefix)
    })
    const { search, address } = usePostalCode({ auto: false })
    const p1 = search('1500002')
    const p2 = search('4980000')
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r2?.prefecture).toBe('愛知県')
    expect(r1).toBeNull() // superseded call reports null, not stale data
    expect(address.value?.prefecture).toBe('愛知県')
  })

  it('withstands a rapid typing burst ending on an incomplete code', async () => {
    configureLoader(async (prefix) => {
      await sleep(10)
      return fixtureLoader(prefix)
    })
    const { code, address, loading } = usePostalCode()
    for (const v of ['1', '15', '150', '1500', '15000', '150000', '1500002', '150000']) {
      code.value = v
      await nextTick()
    }
    await sleep(50)
    expect(address.value).toBeNull()
    expect(loading.value).toBe(false)
  })

  it('reset during a debounced wait leaves no timer behind', async () => {
    let calls = 0
    configureLoader(async (prefix) => {
      calls++
      return fixtureLoader(prefix)
    })
    const { code, reset } = usePostalCode({ debounce: 15 })
    code.value = '1500002'
    await nextTick()
    reset()
    await sleep(50)
    expect(calls).toBe(0)
  })
})

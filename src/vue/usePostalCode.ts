import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { JpAddress, LookupOptions } from '../core/types'
import { lookupAll } from '../core/lookup'
import { isCompletePostalCode, normalizePostalCode } from '../core/normalize'

export interface UsePostalCodeOptions extends LookupOptions {
  /**
   * Auto-lookup as soon as the bound input contains 7 digits.
   * Default: true. Set false to trigger manually via search().
   */
  auto?: boolean
  /** Debounce for auto mode, in ms. Default: 0 (postal codes are fixed-length; usually no debounce needed). */
  debounce?: number
}

/**
 * Vue 3 composable for Japanese postal-code → address lookup.
 *
 *   const { code, address, loading, notFound } = usePostalCode()
 *   // <input v-model="code" />
 *   // address fills automatically when 7 digits are entered
 */
export function usePostalCode(options: UsePostalCodeOptions = {}) {
  const { auto = true, debounce = 0, ...lookupOptions } = options

  /** Bind this to your input with v-model. Accepts 〒/full-width/hyphens. */
  const code: Ref<string> = ref('')

  const addresses = shallowRef<JpAddress[]>([])
  const loading = ref(false)
  const error = ref<Error | null>(null)

  /** True when a complete code was searched and nothing matched. */
  const notFound = ref(false)

  /** First (most common) match — what you bind form fields to. */
  const address = computed<JpAddress | null>(() => addresses.value[0] ?? null)

  /** Canonical 7-digit echo of the current input ("1500002"), null when invalid. */
  const normalized = computed(() => normalizePostalCode(code.value))

  let requestId = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  /** Drop pending work and clear results — no in-flight response may land after this. */
  function clearResults(): void {
    requestId++
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    addresses.value = []
    loading.value = false
    notFound.value = false
    error.value = null
  }

  async function search(value?: string): Promise<JpAddress | null> {
    const target = value ?? code.value

    if (!isCompletePostalCode(target)) {
      clearResults()
      return null
    }

    const id = ++requestId

    loading.value = true
    error.value = null
    try {
      const result = await lookupAll(target, lookupOptions)
      // A newer request superseded this one — drop stale result
      if (id !== requestId) return null
      addresses.value = result ?? []
      notFound.value = result !== null && result.length === 0
      return addresses.value[0] ?? null
    } catch (e) {
      if (id === requestId) {
        error.value = e instanceof Error ? e : new Error(String(e))
        addresses.value = []
      }
      return null
    } finally {
      if (id === requestId) loading.value = false
    }
  }

  function reset(): void {
    code.value = ''
    clearResults()
  }

  if (auto) {
    watch(code, (value) => {
      if (timer) clearTimeout(timer)
      if (!isCompletePostalCode(value)) {
        clearResults()
        return
      }
      if (debounce > 0) {
        timer = setTimeout(() => search(value), debounce)
      } else {
        void search(value)
      }
    })
  }

  return {
    code,
    normalized,
    address,
    addresses,
    loading,
    error,
    notFound,
    search,
    reset,
  }
}

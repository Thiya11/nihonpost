/** A resolved Japanese address at town (町域) granularity. */
export interface JpAddress {
  /** 都道府県 e.g. "東京都" */
  prefecture: string
  /** 市区町村 e.g. "渋谷区" */
  city: string
  /** 町域 e.g. "渋谷" — may be empty for codes covering a whole city */
  town: string
  /** 都道府県カナ e.g. "トウキョウト" */
  prefectureKana: string
  /** 市区町村カナ */
  cityKana: string
  /** 町域カナ */
  townKana: string
  /** JIS prefecture number 1–47 (北海道=1 … 沖縄県=47) */
  prefectureCode: number
}

/**
 * Compact on-disk representation of one address:
 * [prefCode, city, town, cityKana, townKana]
 * Prefecture name/kana are derived from prefCode to save ~2MB across the dataset.
 */
export type PackedAddress = [number, string, string, string, string]

/** One data chunk: postal code → one or more packed addresses. */
export type Chunk = Record<string, PackedAddress[]>

/**
 * Pluggable chunk loader. `prefix` is the first 3 digits of the postal code.
 * Return null when the chunk does not exist (prefix not in use).
 */
export type ChunkLoader = (prefix: string) => Promise<Chunk | null>

export interface LookupOptions {
  /**
   * Custom loader for this call. Defaults to the loader set via
   * configureLoader(), falling back to the version-pinned jsDelivr CDN.
   */
  loader?: ChunkLoader
}

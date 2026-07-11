/**
 * build-data.ts — turns Japan Post's utf_ken_all.csv into chunked JSON.
 *
 * Usage:
 *   npm run build:data                     # downloads latest from Japan Post
 *   npm run build:data -- ./utf_ken_all.csv  # use a local copy
 *
 * Output: data/{first3digits}.json
 *   { "1500002": [[13, "渋谷区", "渋谷", "シブヤク", "シブヤ"]], ... }
 *
 * KEN_ALL quirks handled here (this is where most naive parsers break):
 *  1. Long 町域 names are split across multiple rows — merged by tracking
 *     unbalanced （ parentheses.
 *  2. Parenthetical annotations （...）/(...) are stripped: they contain
 *     block ranges, building floors, and exclusion notes, not address text.
 *  3. 「以下に掲載がない場合」 placeholder rows → empty town.
 *  4. 「◯◯の次に番地がくる場合」 rows → empty town.
 *  5. Duplicate rows after stripping are deduped.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

// NB: the old /zipcode/dl/utf/zip/ path now returns a 404 HTML page
const KEN_ALL_URL =
  'https://www.post.japanpost.jp/service/search/zipcode/download/utf/zip/utf_ken_all.zip'
const OUT_DIR = resolve(import.meta.dirname, '../data')

type Row = {
  code: string
  prefCode: number
  city: string
  town: string
  cityKana: string
  townKana: string
}

function parseCsvLine(line: string): string[] {
  // KEN_ALL fields are quoted and never contain embedded quotes/commas-in-quotes
  // beyond simple "..." wrapping, so a light parser is sufficient.
  return line.split(',').map((f) => f.replace(/^"|"$/g, ''))
}

// --- Half-width → full-width katakana ---------------------------------
// KEN_ALL ships kana in half-width (ｼﾌﾞﾔ). We normalize to full-width
// (シブヤ) so consumers never have to deal with it.
const KANA_MAP: Record<string, string> = {
  'ｶﾞ': 'ガ', 'ｷﾞ': 'ギ', 'ｸﾞ': 'グ', 'ｹﾞ': 'ゲ', 'ｺﾞ': 'ゴ',
  'ｻﾞ': 'ザ', 'ｼﾞ': 'ジ', 'ｽﾞ': 'ズ', 'ｾﾞ': 'ゼ', 'ｿﾞ': 'ゾ',
  'ﾀﾞ': 'ダ', 'ﾁﾞ': 'ヂ', 'ﾂﾞ': 'ヅ', 'ﾃﾞ': 'デ', 'ﾄﾞ': 'ド',
  'ﾊﾞ': 'バ', 'ﾋﾞ': 'ビ', 'ﾌﾞ': 'ブ', 'ﾍﾞ': 'ベ', 'ﾎﾞ': 'ボ',
  'ﾊﾟ': 'パ', 'ﾋﾟ': 'ピ', 'ﾌﾟ': 'プ', 'ﾍﾟ': 'ペ', 'ﾎﾟ': 'ポ',
  'ｳﾞ': 'ヴ',
  'ｱ': 'ア', 'ｲ': 'イ', 'ｳ': 'ウ', 'ｴ': 'エ', 'ｵ': 'オ',
  'ｶ': 'カ', 'ｷ': 'キ', 'ｸ': 'ク', 'ｹ': 'ケ', 'ｺ': 'コ',
  'ｻ': 'サ', 'ｼ': 'シ', 'ｽ': 'ス', 'ｾ': 'セ', 'ｿ': 'ソ',
  'ﾀ': 'タ', 'ﾁ': 'チ', 'ﾂ': 'ツ', 'ﾃ': 'テ', 'ﾄ': 'ト',
  'ﾅ': 'ナ', 'ﾆ': 'ニ', 'ﾇ': 'ヌ', 'ﾈ': 'ネ', 'ﾉ': 'ノ',
  'ﾊ': 'ハ', 'ﾋ': 'ヒ', 'ﾌ': 'フ', 'ﾍ': 'ヘ', 'ﾎ': 'ホ',
  'ﾏ': 'マ', 'ﾐ': 'ミ', 'ﾑ': 'ム', 'ﾒ': 'メ', 'ﾓ': 'モ',
  'ﾔ': 'ヤ', 'ﾕ': 'ユ', 'ﾖ': 'ヨ',
  'ﾗ': 'ラ', 'ﾘ': 'リ', 'ﾙ': 'ル', 'ﾚ': 'レ', 'ﾛ': 'ロ',
  'ﾜ': 'ワ', 'ｦ': 'ヲ', 'ﾝ': 'ン',
  'ｧ': 'ァ', 'ｨ': 'ィ', 'ｩ': 'ゥ', 'ｪ': 'ェ', 'ｫ': 'ォ',
  'ｬ': 'ャ', 'ｭ': 'ュ', 'ｮ': 'ョ', 'ｯ': 'ッ',
  'ｰ': 'ー', '｡': '。', '､': '、', '･': '・', '｢': '「', '｣': '」',
}

function toFullWidthKana(s: string): string {
  // Two-char (dakuten/handakuten) sequences first, then single chars
  return s.replace(/[\uFF61-\uFF9F][ﾞﾟ]?/g, (m) => KANA_MAP[m] ?? m)
}

function stripAnnotations(town: string, townKana: string): [string, string] {
  const cleanTown = town.replace(/（.*?）/g, '').replace(/\(.*?\)/g, '')
  const cleanKana = townKana.replace(/\（.*?\）/g, '').replace(/\(.*?\)/g, '')
  return [cleanTown, cleanKana]
}

function main() {
  const localCsv = process.argv[2]
  let csvPath: string

  if (localCsv) {
    csvPath = resolve(localCsv)
    console.log(`Using local CSV: ${csvPath}`)
  } else {
    console.log(`Downloading ${KEN_ALL_URL} ...`)
    const tmp = tmpdir()
    const zipPath = resolve(tmp, 'utf_ken_all.zip')
    execSync(`curl -sL -o "${zipPath}" ${KEN_ALL_URL}`)
    // bsdtar (Windows 10+) extracts zip; Linux/macOS runners ship unzip
    if (process.platform === 'win32') {
      execSync(`tar -xf "${zipPath}" -C "${tmp}"`)
    } else {
      execSync(`unzip -o -q "${zipPath}" -d "${tmp}"`)
    }
    csvPath = resolve(tmp, 'utf_ken_all.csv')
  }

  const raw = readFileSync(csvPath, 'utf8')
  const lines = raw.split(/\r?\n/).filter(Boolean)
  console.log(`${lines.length} raw rows`)

  const rows: Row[] = []

  // --- Pass 1: merge continuation rows -------------------------------
  // A 町域 that overflows the field length is split across rows sharing the
  // same postal code. Detection: an opening （ without its closing ）.
  let pending: { fields: string[]; town: string; townKana: string } | null = null

  for (const line of lines) {
    const f = parseCsvLine(line)
    if (f.length < 9) continue

    const town = f[8]
    const townKana = f[5]

    if (pending) {
      pending.town += town
      pending.townKana += townKana
      const open = (pending.town.match(/（/g) ?? []).length
      const close = (pending.town.match(/）/g) ?? []).length
      if (open <= close) {
        emit(pending.fields, pending.town, pending.townKana)
        pending = null
      }
      continue
    }

    const open = (town.match(/（/g) ?? []).length
    const close = (town.match(/）/g) ?? []).length
    if (open > close) {
      pending = { fields: f, town, townKana }
    } else {
      emit(f, town, townKana)
    }
  }

  function emit(f: string[], town: string, townKana: string) {
    let [cleanTown, cleanKana] = stripAnnotations(town, townKana)
    if (cleanTown === '以下に掲載がない場合' || /の次に番地がくる場合$/.test(cleanTown)) {
      cleanTown = ''
      cleanKana = ''
    }
    rows.push({
      code: f[2],
      prefCode: Number(f[0].slice(0, 2)),
      city: f[7],
      town: cleanTown,
      cityKana: toFullWidthKana(f[4]),
      townKana: toFullWidthKana(cleanKana),
    })
  }

  console.log(`${rows.length} merged rows`)

  // --- Pass 2: group into chunks, dedupe ------------------------------
  const chunks = new Map<string, Record<string, [number, string, string, string, string][]>>()
  const seen = new Set<string>()

  for (const r of rows) {
    const key = `${r.code}|${r.prefCode}|${r.city}|${r.town}`
    if (seen.has(key)) continue
    seen.add(key)

    const prefix = r.code.slice(0, 3)
    if (!chunks.has(prefix)) chunks.set(prefix, {})
    const chunk = chunks.get(prefix)!
    if (!chunk[r.code]) chunk[r.code] = []
    chunk[r.code].push([r.prefCode, r.city, r.town, r.cityKana, r.townKana])
  }

  // --- Write -----------------------------------------------------------
  if (existsSync(OUT_DIR)) rmSync(OUT_DIR, { recursive: true })
  mkdirSync(OUT_DIR, { recursive: true })

  let totalBytes = 0
  for (const [prefix, chunk] of chunks) {
    const json = JSON.stringify(chunk)
    totalBytes += json.length
    writeFileSync(resolve(OUT_DIR, `${prefix}.json`), json)
  }

  const index = [...chunks.keys()].sort()
  writeFileSync(resolve(OUT_DIR, 'index.json'), JSON.stringify(index))

  console.log(
    `Wrote ${chunks.size} chunks (${(totalBytes / 1024 / 1024).toFixed(1)} MB total, ` +
      `avg ${(totalBytes / chunks.size / 1024).toFixed(1)} KB/chunk) → data/`,
  )
}

main()

# 🗾 nihonpost

**Offline Japanese postal code → address lookup for Vue 3.**
TypeScript-first · zero runtime API calls · self-updating data · handles 〒 and full-width input

```
〒１５０-０００２  →  { prefecture: "東京都", city: "渋谷区", town: "渋谷" }
```

## Why nihonpost?

Every Japanese web form needs 郵便番号 → 住所 autofill. Your options today:

| | API-based (zipcloud etc.) | yubinbango-core2 | **nihonpost** |
|---|---|---|---|
| Works offline / no third-party dependency | ❌ | ✅ | ✅ |
| TypeScript types | ❌ | ❌ | ✅ |
| Vue 3 composable | ❌ | ❌ | ✅ |
| Promise-based | ❌ | ❌ (callbacks) | ✅ |
| Full-width & 〒 input normalization | ❌ | partial | ✅ |
| Full-width kana output (シブヤ not ｼﾌﾞﾔ) | ❌ | ❌ | ✅ |
| Data auto-updated monthly via CI | — | ❌ | ✅ |

## Install

```bash
npm i nihonpost
```

## Quick start (Vue 3)

```vue
<script setup lang="ts">
import { usePostalCode } from 'nihonpost/vue'

const { code, address, loading, notFound } = usePostalCode()
</script>

<template>
  <label>郵便番号</label>
  <input v-model="code" placeholder="150-0002" />

  <span v-if="loading">検索中…</span>
  <span v-if="notFound">該当する住所が見つかりません</span>

  <template v-if="address">
    <input :value="address.prefecture" readonly />
    <input :value="address.city" readonly />
    <input :value="address.town" readonly />
  </template>
</template>
```

That's it. The composable watches `code`, normalizes whatever the user types
(`〒１５０ー０００２` works), and fills `address` the moment 7 digits exist.

### Composable API

```ts
const {
  code,        // Ref<string>            — bind to your input
  normalized,  // ComputedRef<string|null> — "1500002" when valid
  address,     // ComputedRef<JpAddress|null> — first match
  addresses,   // ShallowRef<JpAddress[]> — all matches (some codes span 2 cities!)
  loading,     // Ref<boolean>
  notFound,    // Ref<boolean>           — valid code, no match
  error,       // Ref<Error|null>
  search,      // (value?) => Promise<JpAddress|null> — manual trigger
  reset,       // () => void
} = usePostalCode({
  auto: true,      // lookup automatically at 7 digits (default)
  debounce: 0,     // ms; rarely needed since length is fixed
})
```

## Framework-agnostic core

No Vue? Use the core directly:

```ts
import { lookup, lookupAll, formatPostalCode } from 'nihonpost'

const addr = await lookup('150-0002')
// { prefecture: '東京都', city: '渋谷区', town: '渋谷',
//   prefectureKana: 'トウキョウト', cityKana: 'シブヤク', townKana: 'シブヤ',
//   prefectureCode: 13 }

await lookupAll('4980000')
// → 2 results: 愛知県弥富市 AND 三重県桑名郡木曽岬町 (shared codes are real!)

formatPostalCode('１５００００２') // "150-0002"
```

## Data loading

The dataset (~124k codes) is chunked by the first 3 digits into ~900 small
JSON files — your app loads only the chunks it touches, a few KB each.

Copy `node_modules/nihonpost/data` into your static assets and point the
loader at it once, at app startup:

```ts
import { configureLoader, fetchLoader } from 'nihonpost'

configureLoader(fetchLoader('/nihonpost-data'))
// lookups now GET /nihonpost-data/150.json etc., cached after first hit
```

Vite example — add to `vite.config.ts`:

```ts
import { viteStaticCopy } from 'vite-plugin-static-copy'

plugins: [
  viteStaticCopy({
    targets: [{ src: 'node_modules/nihonpost/data/*', dest: 'nihonpost-data' }],
  }),
]
```

Or skip local hosting entirely — the data ships inside the npm package, so
jsDelivr can serve it directly, pinned to your installed version:

```ts
configureLoader(fetchLoader('https://cdn.jsdelivr.net/npm/nihonpost@0.1.0/data'))
```

Any static host works too (GitHub Pages, Cloudflare Pages, S3). It's static
files — there is no API server anywhere.

> **Bundle size note:** none of this data ever enters your JS bundle. The
> browser fetches only the chunks a lookup touches — a few KB each, cached
> after the first hit. The full ~11 MB exists only in `node_modules` (and
> travels as a 1.9 MB tarball).

Custom sources implement one function:

```ts
configureLoader(async (prefix) => {
  const res = await fetch(`https://cdn.example.com/jp-postal/${prefix}.json`)
  return res.ok ? res.json() : null
})
```

## Rebuilding the data yourself

```bash
npm run build:data              # downloads latest utf_ken_all from Japan Post
npm run build:data -- ./my.csv  # or use a local copy
```

The pipeline handles KEN_ALL's sharp edges: multi-row 町域 continuation
merging, parenthetical annotation stripping, 「以下に掲載がない場合」
placeholders, half-width → full-width kana, and deduplication.

A GitHub Action rebuilds the data on the 1st of every month and publishes a
patch release automatically — installs stay current without a server.

## Notes & limits

- Postal codes resolve to **town (町域) level** — that's how Japan's postal
  system works. Users still type the block/building portion themselves.
- Some codes map to multiple municipalities; `address` gives the first,
  `addresses` gives all. Offer a picker if you need precision.
- Data source: [Japan Post 郵便番号データ](https://www.post.japanpost.jp/zipcode/download.html) (public data).

## License

MIT © [Thiyagu Arunachalam](https://thiyaguarunachalam.com)

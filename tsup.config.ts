import { readFileSync } from 'node:fs'
import { defineConfig } from 'tsup'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    vue: 'src/vue.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: ['vue'],
  treeshake: true,
  define: {
    __NIHONPOST_VERSION__: JSON.stringify(pkg.version),
  },
})

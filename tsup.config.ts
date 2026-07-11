import { defineConfig } from 'tsup'

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
})

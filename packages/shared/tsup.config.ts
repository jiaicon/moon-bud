import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  // rrule and zod stay external: both apps resolve them themselves, and
  // bundling rrule into a CJS+ESM dual build is where ESM/CJS interop breaks.
  external: ['zod', 'rrule'],
})

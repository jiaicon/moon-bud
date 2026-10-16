import { defineConfig } from 'vitest/config'

// 纯逻辑单测（theme / api / stores / events / reminders）不需要 uni 的 Vite 插件链，
// 而 @dcloudio/vite-plugin-uni 在测试进程里无法解析 vue 编译器（其 SFC 编译器由
// uni-cli-shared 以别名提供）。给测试单独一份配置，dev:h5 与 build 仍走 vite.config.ts。
export default defineConfig({
  resolve: {
    alias: {
      vue: 'vue/dist/vue.runtime.esm-bundler.js',
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})

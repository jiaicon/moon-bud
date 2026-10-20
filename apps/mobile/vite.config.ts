import { defineConfig } from "vite";
import uni from "@dcloudio/vite-plugin-uni";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  css: {
    preprocessorOptions: {
      scss: {
        // 噪音来自 uview-pro 自己：index.scss 里连着 @import 了四五个文件，
        // 我们这层的两处（App.vue、uni.scss）也照它的文档写着。上游没迁到 @use，
        // 补丁式改它风险大于收益，所以只静音这条弃用告警。
        // Dart Sass 3.0 才真正移除 @import，届时需要回头看 uview-pro 是否跟上了。
        // legacy-js-api 是 @dcloudio/vite-plugin-uni 内部还在用 sass 的旧 JS 接口，
        // 不是我们的代码，等 uni 上游迁移。
        silenceDeprecations: ["import", "legacy-js-api"],
      },
    },
  },
});

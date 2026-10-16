import { createPinia } from 'pinia'
import { createSSRApp } from 'vue'
import uviewPro from 'uview-pro'
import App from './App.vue'

export function createApp() {
  const app = createSSRApp(App)
  app.use(createPinia())
  app.use(uviewPro)
  return { app }
}

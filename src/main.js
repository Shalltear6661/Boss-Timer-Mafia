import { inject } from '@vercel/analytics'
import App from './App.svelte'

inject({ mode: import.meta.env.DEV ? 'development' : 'production' })

const app = new App({
  target: document.getElementById('app'),
})

export default app

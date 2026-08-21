import {defineConfig} from 'vite'

export default defineConfig(({mode}) => ({
  base: mode === 'development' ? './' : '/',
  build: {
    outDir: mode === 'development' ? 'dist/dev' : 'dist/build',
  },
}))

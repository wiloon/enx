import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || JSON.parse(readFileSync('package.json', 'utf-8')).version),
  },
  plugins: [
    react(),
    {
      name: 'copy-manifest',
      writeBundle() {
        // Read version from package.json and sync to manifest.json
        const packageJson = JSON.parse(readFileSync('package.json', 'utf-8'))
        const manifest = JSON.parse(readFileSync('manifest.json', 'utf-8'))
        
        // Update manifest version to match package.json
        if (manifest.version !== packageJson.version) {
          manifest.version = packageJson.version
          writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n')
          console.log(`✓ Synced manifest.json version to ${packageJson.version}`)
        }
        
        copyFileSync('manifest.json', 'dist/manifest.json')
        // Create icons directory and copy icons
        mkdirSync('dist/icons', { recursive: true })
        const icons = readdirSync('icons')
        icons.forEach(icon => {
          copyFileSync(`icons/${icon}`, `dist/icons/${icon}`)
        })
      }
    }
  ],
  build: {
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
        background: resolve(__dirname, 'src/background/background.ts'),
        content: resolve(__dirname, 'src/content/content.ts'),
      },
      output: {
        entryFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId
          if (facadeModuleId?.includes('background')) {
            return 'background.js'
          }
          if (facadeModuleId?.includes('content')) {
            return 'content.js'
          }
          return '[name].js'
        },
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]'
      }
    },
    outDir: 'dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
})
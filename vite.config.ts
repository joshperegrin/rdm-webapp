import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import tsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import svgr from "vite-plugin-svgr"
import { fileURLToPath } from 'url'
import fs from 'node:fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Copy only SQL schema/seed files to dist-electron (NOT the database itself)
// database.db lives permanently in /resources and is never copied or wiped
function copySqlFiles() {
  const srcDir = path.join(__dirname, 'electron/database');
  const destDir = path.join(__dirname, 'dist-electron');

  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const files = ['schema.sql', 'seed.sql'];

  files.forEach(file => {
    const src = path.join(srcDir, file);
    const dest = path.join(destDir, file);
    
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
      console.log(`[Vite Config] ✅ Copied ${file} to dist-electron`);
    }
  });
}

copySqlFiles();

export default defineConfig({
  server: {
    watch: {
      ignored: [
        '**/resources/maptiles/**',
        '**/resources/captures/**',
        '**/resources/python/**',
      ]
    }
  },
  plugins: [
    svgr(),
    tailwindcss(),
    react(),
    tsConfigPaths(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3']
            }
          }
        }
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            rollupOptions: {
              external: ['better-sqlite3'] 
            }
          }
        }
      },
      renderer: process.env.NODE_ENV === 'test'
        ? undefined
        : {},
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    }
  }
})
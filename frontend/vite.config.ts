import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
const srcDir = path.resolve(__dirname, "./src").replace(/\\/g, "/")

export default defineConfig({
  base: '/',
  plugins: [inspectAttr(), react()],
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${srcDir}/` },
      { find: "@", replacement: srcDir },
    ],
  },
});

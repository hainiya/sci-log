
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: 'assets',
    // 产物文件名固定（panel.js / panel.css），直接覆盖即可；
    // 清空目录会触发宿主安全删除拦截导致构建失败
    emptyOutDir: false,
    sourcemap: false,
    lib: {
      entry: path.resolve(__dirname, 'ui', 'Panel.tsx'),
      formats: ['es'],
      fileName: () => 'panel.js',
    },
    rollupOptions: {
      output: {
        assetFileNames: (assetInfo) => assetInfo.name?.endsWith('.css') ? 'panel.css' : '[name][extname]',
      },
    },
  },
});

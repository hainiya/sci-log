
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    // @hana/* 通过 symlink 指向 openhanako/packages;默认 vite 会 realpath 到真实目录,
    // 再从那里解析 @hana/* / react 会找不到(openhanako 根无 link)。关闭 realpath,
    // 让解析沿 node_modules/@hana 的 link 路径进行,react 也从插件根命中。
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
  },
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

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// 独立于 build 的测试配置（不继承 vite.config.ts 的 build define/outDir）。
// 组件走与构建一致的解析（preserveSymlinks / react dedupe），但测试在 jsdom 下运行。
export default defineConfig({
  plugins: [react()],
  resolve: {
    preserveSymlinks: true,
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/ui/setup.ts'],
    css: false,
    include: ['tests/ui/**/*.test.{ts,tsx}'],
  },
});

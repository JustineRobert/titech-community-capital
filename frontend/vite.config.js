// vite.config.js

import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      react({
        jsxRuntime: 'automatic',
      }),
    ],

    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_PORT) || 3000,
      strictPort: false,

      proxy: {
        '/api': {
          target:
            env.VITE_API_URL ||
            'http://localhost:5000',
          changeOrigin: true,
          secure: false,
          ws: true,
        },

        '/socket.io': {
          target:
            env.VITE_API_URL ||
            'http://localhost:5000',
          changeOrigin: true,
          ws: true,
        },
      },
    },

    preview: {
      port: 4173,
      strictPort: false,
    },

    resolve: {
      alias: {
        '@': path.resolve(
          __dirname,
          './src'
        ),

        '@components': path.resolve(
          __dirname,
          './src/components'
        ),

        '@hooks': path.resolve(
          __dirname,
          './src/hooks'
        ),

        '@services': path.resolve(
          __dirname,
          './src/services'
        ),

        '@store': path.resolve(
          __dirname,
          './src/store'
        ),

        '@utils': path.resolve(
          __dirname,
          './src/utils'
        ),

        '@assets': path.resolve(
          __dirname,
          './src/assets'
        ),
      },
    },

    define: {
      __APP_VERSION__: JSON.stringify(
        process.env.npm_package_version
      ),

      'process.env.VITE_API_URL':
        JSON.stringify(
          env.VITE_API_URL ||
            'http://localhost:5000'
        ),
    },

    build: {
      outDir: 'dist',

      emptyOutDir: true,

      target: 'es2020',

      sourcemap:
        mode === 'development',

      minify: 'terser',

      cssCodeSplit: true,

      chunkSizeWarningLimit: 1000,

      assetsInlineLimit: 4096,

      rollupOptions: {
        output: {
          manualChunks: {
            react: [
              'react',
              'react-dom',
            ],

            router: [
              'react-router-dom',
            ],

            redux: [
              'redux',
              'react-redux',
              'redux-thunk',
            ],

            forms: [
              'formik',
              'yup',
            ],

            charts: [
              'recharts',
            ],
          },

          chunkFileNames:
            'assets/js/[name]-[hash].js',

          entryFileNames:
            'assets/js/[name]-[hash].js',

          assetFileNames:
            'assets/[ext]/[name]-[hash].[ext]',
        },
      },

      terserOptions: {
        compress: {
          drop_console:
            mode === 'production',

          drop_debugger: true,
        },
      },
    },

    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        'axios',
        'socket.io-client',
      ],
    },

    test: {
      globals: true,

      environment: 'jsdom',

      setupFiles:
        './src/setupTests.js',

      css: true,

      clearMocks: true,

      restoreMocks: true,

      mockReset: true,

      testTimeout: 10000,

      hookTimeout: 10000,

      coverage: {
        provider: 'v8',

        reporter: [
          'text',
          'html',
          'json',
          'lcov',
        ],

        reportsDirectory:
          './coverage',

        exclude: [
          'node_modules/',
          'dist/',
          'coverage/',
          '**/*.config.js',
          '**/*.test.jsx',
          '**/*.spec.jsx',
          'src/setupTests.js',
        ],

        thresholds: {
          statements: 80,
          branches: 75,
          functions: 80,
          lines: 80,
        },
      },
    },
  };
});
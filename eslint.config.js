import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'

// ESLint "flat config". Foco no código do APP (src/). O service worker
// (public/*.js, roda no navegador com globais próprios) e a Edge Function
// (Deno/TypeScript) rodam em OUTROS runtimes e ficam de fora do lint do app.
export default [
  {
    ignores: [
      'dist',
      'dev-dist',
      'node_modules',
      '.claude',         // worktrees temporárias de subagentes
      'coverage',
      'supabase',        // SQL + Edge Function (Deno/TS): outro runtime
      'public',          // service worker + scripts estáticos: globais de SW
      'src/assets',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.es2021 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    plugins: { react, 'react-hooks': reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',            // projeto não usa PropTypes
      'react/no-unknown-property': 'off',
      'react/no-unescaped-entities': 'off', // aspas/apóstrofos em texto JSX: ruído, não bug
      // não FALHA o CI por variável não usada — só avisa (refactor gradual)
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Regras NOVAS/estritas do react-hooks v7 (prontidão pro React Compiler):
      // ficam como AVISO pra não travar o CI num código que já funciona. As
      // clássicas (rules-of-hooks, exhaustive-deps) seguem valendo. O refactor
      // do Phaser (usePhaserGame) limpa o 'refs' de verdade; depois dá pra
      // subir estas pra 'error'.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
  },
  // Arquivos de config e testes: ambiente Node + globais de teste
  {
    files: ['**/*.test.{js,jsx}', 'vitest.setup.js', 'vitest.config.js', 'eslint.config.js', 'vite.config.js'],
    languageOptions: { globals: { ...globals.node, ...globals.vitest } },
  },
]

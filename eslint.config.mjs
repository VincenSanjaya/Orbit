import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import jsxA11y from 'eslint-plugin-jsx-a11y';
export default tseslint.config(
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'jsx-a11y': jsxA11y },
    rules: {
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.configs.recommended.rules,
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
    },
    settings: { 'jsx-a11y': { components: { Link: 'a' } } },
  },
  { files: ['**/*.mjs'], languageOptions: { globals: { process: 'readonly' } } },
);

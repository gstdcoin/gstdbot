import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import globals from 'globals';

export default [
    js.configs.recommended,
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    {
        files: ['src/**/*.ts'],
        plugins: {
            '@typescript-eslint': tsPlugin,
        },
        languageOptions: {
            parser: tsParser,
            globals: {
                ...globals.node,
            },
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': 'warn',
            'no-unused-vars': 'warn',
            'no-empty': 'off',
            'no-case-declarations': 'off',
            'no-undef': 'off',
            'no-useless-escape': 'off',
            '@typescript-eslint/no-var-requires': 'off',
            'prefer-const': 'warn',
        },
    },
];

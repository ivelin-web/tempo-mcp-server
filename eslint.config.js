import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

import eslintConfigPrettier from 'eslint-config-prettier';

// See: https://typescript-eslint.io/users/configs/#stylistic
const weAreHighlyProficientInTypeScript = true; // Feel free to set this flag to false depending on your team’s TypeScript proficiency

// See: https://typescript-eslint.io/users/configs/#strict
const weLikeCodeStylingConsistencyEvenIfSomeRulesAreOpiniated = true;

// See: https://typescript-eslint.io/getting-started/typed-linting
const weDontMindSlowerRulesAsTheyAreUsuallyTheBestBecauseTheyUseTypeInformation = true; // Set to false if you want to disable (slower) type-checked rules

export default tseslint.config(
  // Ignore some directories
  {
    ignores: ['node_modules', 'dist', 'build', 'coverage'],
  },
  // Some additional eslint configuration options
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      parserOptions: {
        projectService: {
          // allows configuration files (such as this file) to be linted even if it's not listed in the tsconfig.json
          allowDefaultProject: ['*.mjs', '*.js'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // Use recommended rules
  eslint.configs.recommended,

  // Use TypeScript rules based on proficiency
  ...(weAreHighlyProficientInTypeScript
    ? [
        // Strict lint rules, hooray!
        weDontMindSlowerRulesAsTheyAreUsuallyTheBestBecauseTheyUseTypeInformation
          ? tseslint.configs.strictTypeChecked.map((config) => ({
              ...config,
              files: ['**/*.ts'],
            }))
          : tseslint.configs.strict,
      ]
    : [
        // Recommended lint rules only, good enough!
        weDontMindSlowerRulesAsTheyAreUsuallyTheBestBecauseTheyUseTypeInformation
          ? tseslint.configs.recommendedTypeChecked.map((config) => ({
              ...config,
              files: ['**/*.ts'],
            }))
          : tseslint.configs.recommended,
      ]),

  // Optionally add rules that enforce code styling consistency
  ...(weLikeCodeStylingConsistencyEvenIfSomeRulesAreOpiniated
    ? [tseslint.configs.stylistic]
    : []),

  // Any overrides here (but ideally you just stick with the standards)
  // During migrations you might have some exceptions defined here though
  {
    rules: {
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/array-type': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',
      '@typescript-eslint/no-inferrable-types': 'warn',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',
      'no-dupe-keys': 'warn',
    },
  },
  {
    // You might also want to be less strict for test files, which can be done with
    files: ['**/*.test.ts'],
    rules: {
      // ...
    },
  },

  // Disable rules that would conflict with prettier
  eslintConfigPrettier,
);

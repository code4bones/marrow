# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## CI/CD

`.gitlab-ci.yml` runs on the project's GitLab runner (shell executor, `docker` on PATH):

- **build** (every branch push / MR): `docker build --target build` runs `npm run lint` and `npm run build` (`tsc -b && vite build`) inside the image; the resulting `dist/` is extracted via `docker cp` and kept as a job artifact. A failure at any step (lint, typecheck, or build) fails the job.
- **deploy** (tag pushes only): copies `dist/` to `$FRONT_DEPLOY_PATH` on the runner host. The runner already lives on the deploy target, so this is a local `rsync`, not an SSH step.

Nginx serves the static build at `https://$PROD_DOMAIN/` (SPA `try_files` fallback to `index.html`); `/api/*` on the same host/port continues to proxy to the gateway. See `deploy/nginx/marrow-ui.locations.conf` for the include, already merged into `backend/deploy/nginx/marrow.example.conf`.

`VITE_GRAPHQL_URL` is baked in at build time (Vite env var). It defaults to `https://marrow.example.com/api/graphql` in the Dockerfile; override with `--build-arg VITE_GRAPHQL_URL=...` for a different target.

To deploy: push a tag on `main`. To change the deploy path, override the `DEPLOY_PATH` CI/CD variable in GitLab project settings.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

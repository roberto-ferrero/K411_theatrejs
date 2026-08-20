# Timeline 411 + Theatre.js

Laboratorio Three.js con dos modos seleccionables al iniciar:

- `Timeline Theatre.js`: usa Theatre.js 0.7.2 y carga Studio en desarrollo.
- `Timeline 411 HTML`: usa el núcleo propio desacoplado y una vista HTML/SVG.

Ambos consumen `src/state.json`. Timeline 411 exporta el mismo modelo de estado,
por lo que su `animation.json` se puede cargar directamente con
`getProject(id, {state})` de Theatre.js 0.7.2.

## Scripts

- Start the dev server:

```bash
npm run dev
```

- Build for production:

```bash
npm run build
```

- Run automated tests:

```bash
npm test
```

- Preview the production build:

```bash
npm run preview
```

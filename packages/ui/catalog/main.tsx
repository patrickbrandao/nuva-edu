import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Catalog } from './Catalog';
import { Demo } from './Demos';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado');

// `?demo=classroom` e `?demo=admin` abrem as cascas em página inteira (catalog/Demos.tsx);
// `&accent=%23RRGGBB` aplica a cor de destaque em <html>, como os sites fazem.
const params = new URLSearchParams(window.location.search);
const demo = params.get('demo');

createRoot(root).render(
  <StrictMode>
    {demo ? (
      <Demo name={demo} theme={params.get('theme')} accent={params.get('accent')} />
    ) : (
      <Catalog />
    )}
  </StrictMode>,
);

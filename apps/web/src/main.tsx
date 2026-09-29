import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './i18n';
import './index.css';
import { App } from './App.tsx';
import { initTheme } from './lib/theme.ts';
import { createQueryClient } from './lib/query.ts';
import { createAppRouter } from './router.tsx';

initTheme();

const queryClient = createQueryClient();
const router = createAppRouter({ queryClient });

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <App router={router} queryClient={queryClient} />
  </StrictMode>,
);

import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { queryClient } from './api';
import '../theme.css';
import './styles.css';

const root = document.getElementById('root');
if (root) {
	createRoot(root).render(<QueryClientProvider client={queryClient}><App /></QueryClientProvider>);
}

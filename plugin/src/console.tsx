import { createRoot } from 'react-dom/client';
import { ConsoleApp } from './console/ConsoleApp';
import './console/styles.css';

createRoot(document.getElementById('root')!).render(<ConsoleApp />);

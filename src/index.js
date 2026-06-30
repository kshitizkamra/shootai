import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles/app.css';
import App from './App';
import { installWebShim } from './utils/webShim';

// Install browser shim before app renders — replaces window.electronAPI
installWebShim();

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

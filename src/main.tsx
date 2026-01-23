import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.tsx'
import '@/index.css'
import { HashRouter } from 'react-router'
import { Provider } from 'jotai'
import { store } from './state'
import "leaflet/dist/leaflet.css";

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <Provider store={store}>
        <App />
      </Provider>
    </HashRouter>
  </React.StrictMode>,
)

// Use contextBridge

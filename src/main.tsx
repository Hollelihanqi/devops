import React from 'react'
import ReactDOM from 'react-dom/client'
import 'virtual:uno.css'
import '@unocss/reset/tailwind.css'
import './styles/ambient-background.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// live-query sheet — imported AFTER index.css so its equal-specificity
// overrides (query-bar width rule + pipeline step list) win the cascade.
import './query-steps.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

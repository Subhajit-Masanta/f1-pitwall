import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import App from './App.jsx'
import { AudioProvider } from './audio/AudioProvider'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AudioProvider>
      <App />
    </AudioProvider>
  </StrictMode>,
)

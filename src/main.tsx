import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/global.scss'
import App from './App.tsx'
import { AuthProvider } from './features/auth/auth-provider.tsx'
import { TranscriberThemeProvider } from './lib/transcriber-theme.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <TranscriberThemeProvider>
          <App />
        </TranscriberThemeProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)

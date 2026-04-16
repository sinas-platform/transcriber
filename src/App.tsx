import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { ProtectedRoute } from './components/ProtectedRoute'
import { getPendingOtpSession } from './features/auth/otp-session'
import { useAuth } from './features/auth/use-auth'
import { AllRecordingsPage } from './pages/AllRecordingsPage'
import { ChatPage } from './pages/ChatPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { OtpPage } from './pages/OtpPage'
import { RecordingDetailsEditPage } from './pages/RecordingDetailsEditPage'
import { RecordingPage } from './pages/RecordingPage'
import { SettingsPage } from './pages/SettingsPage'

function App() {
  const { isAuthenticated } = useAuth()
  const location = useLocation()
  const hasPendingOtpSession = getPendingOtpSession() !== null
  const keepLoginVisible =
    (location.state as { keepLoginVisibleAfterWorkspaceSwitch?: boolean } | null)
      ?.keepLoginVisibleAfterWorkspaceSwitch === true

  return (
    <Routes>
      <Route
        path="/auth/login"
        element={
          isAuthenticated && !keepLoginVisible ? (
            <Navigate to={{ pathname: '/', search: location.search }} replace />
          ) : (
            <LoginPage />
          )
        }
      />
      <Route
        path="/auth/otp"
        element={
          isAuthenticated && !hasPendingOtpSession ? (
            <Navigate to={{ pathname: '/', search: location.search }} replace />
          ) : (
            <OtpPage />
          )
        }
      />

      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings"
        element={
          <ProtectedRoute>
            <AllRecordingsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings/:recordingId/details/edit"
        element={
          <ProtectedRoute>
            <RecordingDetailsEditPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings/:recordingId/chats/:chatId"
        element={
          <ProtectedRoute>
            <ChatPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/recordings/:recordingId"
        element={
          <ProtectedRoute>
            <RecordingPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="*"
        element={
          <Navigate
            to={{
              pathname: isAuthenticated ? '/' : '/auth/login',
              search: location.search,
            }}
            replace
          />
        }
      />
    </Routes>
  )
}

export default App

import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import { LoadingBlock } from "./components/ui/Feedback";
import { homePath } from "./lib/routes";

/**
 * Route level code splitting.
 *
 * Every page is loaded on demand, so the initial bundle only contains the
 * shell, the authentication logic and the landing page. A caregiver who
 * never opens the medication screen never downloads the medication code.
 */
const Landing = lazy(() => import("./pages/Landing"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const SeniorDashboard = lazy(() => import("./pages/senior/SeniorDashboard"));
const CheckInPage = lazy(() => import("./pages/senior/CheckInPage"));
const VitalsPage = lazy(() => import("./pages/senior/VitalsPage"));
const MedicationsPage = lazy(() => import("./pages/senior/MedicationsPage"));
const ContactsPage = lazy(() => import("./pages/senior/ContactsPage"));
const ProfilePage = lazy(() => import("./pages/senior/ProfilePage"));
const CaregiverDashboard = lazy(() => import("./pages/caregiver/CaregiverDashboard"));
const ElderDetailPage = lazy(() => import("./pages/caregiver/ElderDetailPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const NotFound = lazy(() => import("./pages/NotFound"));

/** Gate that requires an authenticated session. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "loading") return <LoadingBlock label="Checking your session…" />;
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/** Gate that keeps signed-in users away from the public pages. */
function RedirectIfAuthenticated({ children }: { children: React.ReactNode }) {
  const { status, user } = useAuth();

  if (status === "loading") return <LoadingBlock label="Loading…" />;
  if (status === "authenticated") return <Navigate to={homePath(user)} replace />;
  return <>{children}</>;
}

/**
 * The marketing page doubles as the front door: a signed-in visitor is sent
 * straight to their dashboard instead of seeing "Sign in" again.
 */
function HomeRoute() {
  const { status, user } = useAuth();

  if (status === "loading") return <LoadingBlock label="Loading…" />;
  if (status === "authenticated") return <Navigate to={homePath(user)} replace />;
  return <Landing />;
}

export function App() {
  return (
    <Suspense fallback={<LoadingBlock label="Loading…" />}>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route
          path="/login"
          element={
            <RedirectIfAuthenticated>
              <Login />
            </RedirectIfAuthenticated>
          }
        />
        <Route
          path="/register"
          element={
            <RedirectIfAuthenticated>
              <Register />
            </RedirectIfAuthenticated>
          }
        />

        {/* -------------------------------------------------- senior --- */}
        <Route
          path="/app"
          element={
            <RequireAuth>
              <SeniorDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/app/check-in"
          element={
            <RequireAuth>
              <CheckInPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/health"
          element={
            <RequireAuth>
              <VitalsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/medicines"
          element={
            <RequireAuth>
              <MedicationsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/contacts"
          element={
            <RequireAuth>
              <ContactsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/app/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />

        {/* ----------------------------------------------- caregiver --- */}
        <Route
          path="/caregiver"
          element={
            <RequireAuth>
              <CaregiverDashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/caregiver/:elderId"
          element={
            <RequireAuth>
              <ElderDetailPage />
            </RequireAuth>
          }
        />

        <Route
          path="/notifications"
          element={
            <RequireAuth>
              <NotificationsPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}

import { lazy, Suspense } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import HomeGate from "./components/HomeGate.jsx";
import AppShell from "./layouts/AppShell.jsx";
import PatientLoginPage from "./pages/PatientLoginPage.jsx";
import PatientRegisterPage from "./pages/PatientRegisterPage.jsx";

// Lazy-load the in-app screens so the first paint (login/register) stays light.
const PatientDashboard = lazy(() => import("./pages/PatientDashboard.jsx"));
const PatientAppointments = lazy(() => import("./pages/PatientAppointments.jsx"));
const PatientHealthRecords = lazy(() => import("./pages/PatientHealthRecords.jsx"));
const VisitSummaryPage = lazy(() => import("./pages/VisitSummaryPage.jsx"));
const PatientBilling = lazy(() => import("./pages/PatientBilling.jsx"));
const PatientProfile = lazy(() => import("./pages/PatientProfile.jsx"));
const RequestVisitLayout = lazy(() => import("./pages/request-visit/RequestVisitLayout.jsx"));
const RequestVisitFormGate = lazy(() => import("./pages/request-visit/RequestVisitFormGate.jsx"));
const RequestVisitReview = lazy(() => import("./pages/request-visit/RequestVisitReview.jsx"));
const RequestVisitAwaiting = lazy(() => import("./pages/request-visit/RequestVisitAwaiting.jsx"));
const RequestVisitTracking = lazy(() => import("./pages/request-visit/RequestVisitTracking.jsx"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage.jsx"));

function RouteFallback() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-white">
      <span className="size-8 animate-spin rounded-full border-2 border-[#d6ebea] border-t-[#065a60]" />
    </div>
  );
}

function App() {
  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/" element={<HomeGate />} />
      <Route path="/welcome" element={<Navigate to="/" replace />} />
      <Route path="/login" element={<PatientLoginPage />} />
      <Route path="/register" element={<PatientRegisterPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route path="dashboard" element={<PatientDashboard />} />
        <Route path="active-visit" element={<Navigate to="/request-visit/tracking" replace />} />
        <Route path="request-visit" element={<RequestVisitLayout />}>
          <Route index element={<RequestVisitFormGate />} />
          <Route path="review" element={<RequestVisitReview />} />
          <Route path="awaiting" element={<RequestVisitAwaiting />} />
          <Route path="tracking" element={<RequestVisitTracking />} />
        </Route>
        <Route path="appointments" element={<PatientAppointments />} />
        <Route path="health-records" element={<PatientHealthRecords />} />
        <Route path="health-records/visits/:consultationId" element={<VisitSummaryPage />} />
        <Route path="consultations" element={<Navigate to="/health-records" replace />} />
        <Route path="billing" element={<PatientBilling />} />
        <Route path="profile" element={<PatientProfile />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
  );
}

export default App;

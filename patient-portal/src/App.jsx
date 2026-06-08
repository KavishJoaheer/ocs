import { Routes, Route, Navigate } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import HomeGate from "./components/HomeGate.jsx";
import AppShell from "./layouts/AppShell.jsx";
import PatientLoginPage from "./pages/PatientLoginPage.jsx";
import PatientRegisterPage from "./pages/PatientRegisterPage.jsx";
import PatientDashboard from "./pages/PatientDashboard.jsx";
import PatientActiveVisit from "./pages/PatientActiveVisit.jsx";
import PatientAppointments from "./pages/PatientAppointments.jsx";
import PatientHealthRecords from "./pages/PatientHealthRecords.jsx";
import PatientBilling from "./pages/PatientBilling.jsx";
import PatientProfile from "./pages/PatientProfile.jsx";
import RequestVisitLayout from "./pages/request-visit/RequestVisitLayout.jsx";
import RequestVisitForm from "./pages/request-visit/RequestVisitForm.jsx";
import RequestVisitReview from "./pages/request-visit/RequestVisitReview.jsx";
import RequestVisitAwaiting from "./pages/request-visit/RequestVisitAwaiting.jsx";
import RequestVisitTracking from "./pages/request-visit/RequestVisitTracking.jsx";

function App() {
  return (
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
        <Route path="active-visit" element={<PatientActiveVisit />} />
        <Route path="request-visit" element={<RequestVisitLayout />}>
          <Route index element={<RequestVisitForm />} />
          <Route path="review" element={<RequestVisitReview />} />
          <Route path="awaiting" element={<RequestVisitAwaiting />} />
          <Route path="tracking" element={<RequestVisitTracking />} />
        </Route>
        <Route path="appointments" element={<PatientAppointments />} />
        <Route path="health-records" element={<PatientHealthRecords />} />
        <Route path="consultations" element={<Navigate to="/health-records" replace />} />
        <Route path="billing" element={<PatientBilling />} />
        <Route path="profile" element={<PatientProfile />} />
      </Route>
    </Routes>
  );
}

export default App;

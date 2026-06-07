import { Routes, Route } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppShell from "./layouts/AppShell.jsx";
import PatientLoginPage from "./pages/PatientLoginPage.jsx";
import PatientRegisterPage from "./pages/PatientRegisterPage.jsx";
import PatientDashboard from "./pages/PatientDashboard.jsx";
import PatientActiveVisit from "./pages/PatientActiveVisit.jsx";
import PatientAppointments from "./pages/PatientAppointments.jsx";
import PatientConsultations from "./pages/PatientConsultations.jsx";
import PatientBilling from "./pages/PatientBilling.jsx";
import PatientProfile from "./pages/PatientProfile.jsx";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<PatientLoginPage />} />
      <Route path="/register" element={<PatientRegisterPage />} />
      <Route
        element={
          <ProtectedRoute>
            <AppShell />
          </ProtectedRoute>
        }
      >
        <Route index element={<PatientDashboard />} />
        <Route path="active-visit" element={<PatientActiveVisit />} />
        <Route path="appointments" element={<PatientAppointments />} />
        <Route path="consultations" element={<PatientConsultations />} />
        <Route path="billing" element={<PatientBilling />} />
        <Route path="profile" element={<PatientProfile />} />
      </Route>
    </Routes>
  );
}

export default App;

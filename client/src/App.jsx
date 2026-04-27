import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppShell from "./layouts/AppShell.jsx";
import AppointmentsPage from "./pages/AppointmentsPage.jsx";
import BillingPage from "./pages/BillingPage.jsx";
import ConsultationDetailPage from "./pages/ConsultationDetailPage.jsx";
import ConsultationsPage from "./pages/ConsultationsPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import DoctorWorkspacePage from "./pages/DoctorWorkspacePage.jsx";
import DoctorsPage from "./pages/DoctorsPage.jsx";
import HcmNewsPage from "./pages/HcmNewsPage.jsx";
import InventoryPage from "./pages/InventoryPage.jsx";
import LabWorkspacePage from "./pages/LabWorkspacePage.jsx";
import LiveReportPage from "./pages/LiveReportPage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OperatorBillingStatusPage from "./pages/OperatorBillingStatusPage.jsx";
import OperatorWorkspacePage from "./pages/OperatorWorkspacePage.jsx";
import PatientProfilePage from "./pages/PatientProfilePage.jsx";
import PatientsPage from "./pages/PatientsPage.jsx";

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator", "lab_tech", "accountant"]} />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/hcm-news" element={<HcmNewsPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator", "lab_tech"]} />}>
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<PatientProfilePage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "lab_tech"]} />}>
            <Route path="/inventory" element={<InventoryPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor"]} />}>
            <Route path="/appointments" element={<AppointmentsPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["doctor"]} />}>
            <Route
              path="/doctor/current-week-roster"
              element={<DoctorWorkspacePage workspaceKey="current-week-roster" />}
            />
            <Route
              path="/doctor/april-roster"
              element={<DoctorWorkspacePage workspaceKey="april-roster" />}
            />
            <Route
              path="/doctor/hcm-updates"
              element={<Navigate to="/hcm-news" replace />}
            />
            <Route
              path="/doctor/scheduled-visits"
              element={<DoctorWorkspacePage workspaceKey="scheduled-visits" />}
            />
            <Route
              path="/doctor/pending-payment"
              element={<DoctorWorkspacePage workspaceKey="pending-payment" />}
            />
            <Route
              path="/doctor/patients-seen-april"
              element={<DoctorWorkspacePage workspaceKey="patients-seen-april" />}
            />
            <Route
              path="/doctor/assigned-patients"
              element={<DoctorWorkspacePage workspaceKey="assigned-patients" />}
            />
          </Route>

          <Route element={<ProtectedRoute roles={["operator"]} />}>
            <Route
              path="/operator/billing-status"
              element={<OperatorBillingStatusPage />}
            />
            <Route
              path="/operator/current-week-roster"
              element={<OperatorWorkspacePage workspaceKey="current-week-roster" />}
            />
            <Route
              path="/operator/april-roster"
              element={<OperatorWorkspacePage workspaceKey="april-roster" />}
            />
            <Route
              path="/operator/scheduled-visits"
              element={<OperatorWorkspacePage workspaceKey="scheduled-visits" />}
            />
            <Route
              path="/operator/pending-payment"
              element={<OperatorWorkspacePage workspaceKey="pending-payment" />}
            />
            <Route
              path="/operator/long-term-review"
              element={<OperatorWorkspacePage workspaceKey="long-term-review" />}
            />
            <Route
              path="/operator/review-appointments-april"
              element={<OperatorWorkspacePage workspaceKey="review-appointments-april" />}
            />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor"]} />}>
            <Route path="/team-operations" element={<DoctorsPage />} />
            <Route path="/doctors" element={<Navigate to="/team-operations" replace />} />
            <Route path="/live-report" element={<LiveReportPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "lab_tech"]} />}>
            <Route path="/consultations" element={<ConsultationsPage />} />
            <Route path="/consultations/:id" element={<ConsultationDetailPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "lab_tech"]} />}>
            <Route path="/lab" element={<LabWorkspacePage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "accountant"]} />}>
            <Route path="/billing" element={<BillingPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}

export default App;

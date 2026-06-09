import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./components/ProtectedRoute.jsx";
import AppShell from "./layouts/AppShell.jsx";
import LoginPage from "./pages/LoginPage.jsx";

// Route-level code splitting: each page becomes its own chunk that loads on
// demand, so the initial staff-portal bundle stays small and the app feels
// instant. Login + the layout shell stay eager for an immediate first paint.
const AppointmentsPage = lazy(() => import("./pages/AppointmentsPage.jsx"));
const BillingPage = lazy(() => import("./pages/BillingPage.jsx"));
const ConsultationDetailPage = lazy(() => import("./pages/ConsultationDetailPage.jsx"));
const ConsultationsPage = lazy(() => import("./pages/ConsultationsPage.jsx"));
const AdminRosterPage = lazy(() => import("./pages/AdminRosterPage.jsx"));
const DashboardPage = lazy(() => import("./pages/DashboardPage.jsx"));
const DoctorWorkspacePage = lazy(() => import("./pages/DoctorWorkspacePage.jsx"));
const DoctorsPage = lazy(() => import("./pages/DoctorsPage.jsx"));
const HcmNewsPage = lazy(() => import("./pages/HcmNewsPage.jsx"));
const InventoryPage = lazy(() => import("./pages/InventoryPage.jsx"));
const SupplyRequestsPage = lazy(() => import("./pages/SupplyRequestsPage.jsx"));
const LabWorkspacePage = lazy(() => import("./pages/LabWorkspacePage.jsx"));
const LiveReportPage = lazy(() => import("./pages/LiveReportPage.jsx"));
const OperatorBillingStatusPage = lazy(() => import("./pages/OperatorBillingStatusPage.jsx"));
const OperatorWorkspacePage = lazy(() => import("./pages/OperatorWorkspacePage.jsx"));
const LongTermReviewQueuePage = lazy(() => import("./pages/LongTermReviewQueuePage.jsx"));
const PatientProfilePage = lazy(() => import("./pages/PatientProfilePage.jsx"));
const PatientAddPage = lazy(() => import("./pages/PatientAddPage.jsx"));
const PatientsPage = lazy(() => import("./pages/PatientsPage.jsx"));
const StockActivityPage = lazy(() => import("./pages/StockActivityPage.jsx"));
const VisitRequestsPage = lazy(() => import("./pages/VisitRequestsPage.jsx"));

function RouteFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <span className="size-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-500" />
    </div>
  );
}

function App() {
  return (
    <div className="min-h-svh w-full min-w-0 max-w-[100vw] overflow-x-hidden overscroll-x-none">
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator", "lab_tech", "accountant"]} />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/hcm-news" element={<HcmNewsPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator"]} />}>
            <Route path="/patients/add" element={<PatientAddPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator", "lab_tech"]} />}>
            <Route path="/patients" element={<PatientsPage />} />
            <Route path="/patients/:id" element={<PatientProfilePage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor", "operator"]} />}>
            <Route path="/inventory" element={<InventoryPage />} />
            <Route path="/visit-requests" element={<VisitRequestsPage />} />
          </Route>
          <Route element={<ProtectedRoute roles={["admin", "operator"]} />}>
            <Route path="/stock-history" element={<StockActivityPage />} />
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
            <Route path="/doctor/long-term-review" element={<LongTermReviewQueuePage />} />
            <Route path="/supply-requests" element={<SupplyRequestsPage />} />
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
            <Route path="/operator/long-term-review" element={<LongTermReviewQueuePage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin"]} />}>
            <Route path="/team-operations" element={<DoctorsPage />} />
            <Route path="/doctors" element={<Navigate to="/team-operations" replace />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin", "doctor"]} />}>
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
            <Route path="/admin/finance" element={<BillingPage />} />
          </Route>

          <Route element={<ProtectedRoute roles={["admin"]} />}>
            <Route path="/admin/roster" element={<AdminRosterPage />} />
            <Route path="/admin/long-term-review" element={<LongTermReviewQueuePage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Route>
    </Routes>
      </Suspense>
    </div>
  );
}

export default App;

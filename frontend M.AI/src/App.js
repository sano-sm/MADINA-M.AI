import { mobilePdfLinks } from "@/lib/documentPreview";
import "@/App.css";
import React, { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { I18nProvider } from "@/context/I18nContext";
import { SettingsProvider } from "@/context/SettingsContext";
import { CompanyProvider } from "@/context/CompanyContext";
import Layout from "@/components/Layout";
import VoiceCommand from "@/components/VoiceCommand";
import Login from "@/pages/Login";
import Launcher from "@/pages/Launcher";
import Dashboard from "@/pages/Dashboard";
import SummaryDashboard from "@/pages/SummaryDashboard";
import Vehicles from "@/pages/Vehicles";
import Parts from "@/pages/Parts";
import Customers from "@/pages/Customers";
import VehicleSales from "@/pages/VehicleSales";
import ExpensesSalary from "@/pages/ExpensesSalary";
import Funds from "@/pages/Funds";
import OwnerTools from "@/pages/OwnerTools";
import Invoices from "@/pages/Invoices";
import Reports from "@/pages/Reports";
import Audit from "@/pages/Audit";
import Alerts from "@/pages/Alerts";
import Recovery from "@/pages/Recovery";
import Allocations from "@/pages/Allocations";
import Summary from "@/pages/Summary";
import Brokers from "@/pages/Brokers";
import Loans from "@/pages/Loans";
import Stock from "@/pages/Stock";
import Purchases from "@/pages/Purchases";
import Settings from "@/pages/Settings";
import ContainerTT from "@/pages/ContainerTT";
import PinLock from "@/pages/PinLock";

function Protected({ children, perm, bare }) {
  const { user, ready, can } = useAuth();
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm)) return <Navigate to="/" replace />;
  return bare ? children : <Layout>{children}</Layout>;
}

function PersistentVoice() {
  const navigate = useNavigate();
  const [kind, setKind] = useState(null);
  useEffect(() => {
    const handler = (event) => setKind((old) => old === event.detail.kind ? null : event.detail.kind);
    window.addEventListener("madina:toggle-voice", handler);
    return () => window.removeEventListener("madina:toggle-voice", handler);
  }, []);
  return kind ? <VoiceCommand kind={kind} navigate={navigate} onClose={() => setKind(null)} /> : null;
}

function Gate() {
  const { ready, locked, user, reconnectKey } = useAuth();
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Loading...</div>;
  if (locked) return <SettingsProvider><PinLock /></SettingsProvider>;
  if (!user) return <AppRoutes />;
  // key={reconnectKey} remounts the app subtree after a reconnect so every page
  // re-runs its mount fetch and existing records reload automatically.
  return (
    <SettingsProvider key={reconnectKey}>
      <AppRoutes />
      <PersistentVoice />
    </SettingsProvider>
  );
}

function ReservedEmptyPage({ name }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-bold text-foreground">{name}</h1>
      <div className="mt-5 min-h-[320px] rounded-xl border border-border bg-card" aria-label={name + " empty workspace"} />
    </main>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Protected bare><Launcher /></Protected>} />
      <Route path="/dashboard" element={<Protected perm="dashboard.view"><Dashboard /></Protected>} />
      <Route path="/vehicles" element={<Protected perm="vehicles.view"><Vehicles /></Protected>} />
      <Route path="/parts" element={<Protected perm="parts.view"><Parts /></Protected>} />
      <Route path="/customers" element={<Protected perm="customers.view"><Customers /></Protected>} />
      <Route path="/finance" element={<Navigate to="/vehicle-sales" replace />} />
      <Route path="/vehicle-sales" element={<Protected perm="finance.view"><VehicleSales /></Protected>} />
      <Route path="/expenses" element={<Protected perm="finance.view"><ExpensesSalary /></Protected>} />
      <Route path="/funds" element={<Protected perm="settings.manage"><Funds /></Protected>} />
      <Route path="/owner" element={<Protected perm="settings.manage"><OwnerTools /></Protected>} />
      <Route path="/reports" element={<Protected perm="reports.view"><Reports /></Protected>} />
      <Route path="/audit" element={<Protected perm="reports.view"><Audit /></Protected>} />
      <Route path="/alerts" element={<Protected perm="dashboard.view"><Alerts /></Protected>} />
      <Route path="/recovery" element={<Protected perm="parts.view"><Recovery /></Protected>} />
      <Route path="/allocations" element={<Protected perm="finance.view"><Allocations /></Protected>} />
      <Route path="/empty/users" element={<Navigate to="/invoices" replace />} />
      <Route path="/invoices" element={<Protected perm="settings.manage"><Invoices /></Protected>} />
      <Route path="/empty/summary" element={<Protected perm="reports.view"><SummaryDashboard /></Protected>} />
      <Route path="/summary" element={<Protected perm="reports.view"><Summary /></Protected>} />
      <Route path="/brokers" element={<Protected perm="finance.view"><Brokers /></Protected>} />
      <Route path="/loans" element={<Protected perm="reports.view"><Loans /></Protected>} />
      <Route path="/stock" element={<Protected perm="reports.view"><Stock /></Protected>} />
      <Route path="/purchases" element={<Protected perm="reports.view"><Purchases /></Protected>} />
      <Route path="/settings" element={<Protected perm="settings.view"><Settings /></Protected>} />
      <Route path="/container" element={<Protected perm="finance.view"><ContainerTT /></Protected>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <div className="App" onClickCapture={mobilePdfLinks}>
      <I18nProvider>
        <AuthProvider>
          <CompanyProvider>
            <BrowserRouter>
              <Gate />
              <Toaster position="top-center" theme="dark" richColors />
            </BrowserRouter>
          </CompanyProvider>
        </AuthProvider>
      </I18nProvider>
    </div>
  );
}

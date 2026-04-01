import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { TrainingDashboard } from "./components/TrainingDashboard";

function SharedDashboardRoute() {
  const { token } = useParams<{ token: string }>();
  return <TrainingDashboard readOnly initialToken={token ?? ""} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<TrainingDashboard />} />
      <Route path="/d/:token" element={<SharedDashboardRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

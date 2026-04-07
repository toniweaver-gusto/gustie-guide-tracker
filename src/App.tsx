import {
  Navigate,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { TrainingDashboard } from "./components/TrainingDashboard";

function SharedDashboardRoute() {
  const { token } = useParams<{ token: string }>();
  return <TrainingDashboard readOnly initialToken={token ?? ""} />;
}

/** Home: optional `?share=TOKEN` for read-only shared view (GitHub Pages). */
function HomeDashboard() {
  const [searchParams] = useSearchParams();
  const share = searchParams.get("share")?.trim();
  if (share) {
    return <TrainingDashboard readOnly initialToken={share} />;
  }
  return <TrainingDashboard />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeDashboard />} />
      <Route path="/d/:token" element={<SharedDashboardRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

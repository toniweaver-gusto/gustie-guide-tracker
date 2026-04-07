import {
  Navigate,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { TeamLandingPage } from "./components/TeamLandingPage";
import { TrainingDashboard } from "./components/TrainingDashboard";

function SharedDashboardRoute() {
  const { token } = useParams<{ token: string }>();
  return <TrainingDashboard readOnly initialToken={token ?? ""} />;
}

/** `/`: team manager, or `?share=TOKEN` read-only snapshot. */
function HomeRoute() {
  const [searchParams] = useSearchParams();
  const share = searchParams.get("share")?.trim();
  if (share) {
    return <TrainingDashboard readOnly initialToken={share} />;
  }
  return <TeamLandingPage />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomeRoute />} />
      <Route path="/dashboard" element={<TrainingDashboard />} />
      <Route path="/d/:token" element={<SharedDashboardRoute />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

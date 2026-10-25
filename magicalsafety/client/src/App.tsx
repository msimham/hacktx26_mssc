import { Preview3D } from "./routes/Preview3D";
import { Route, Routes } from "react-router-dom";
import { StatusPopover } from "./components/StatusPopover";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./routes/Home";
import { Play } from "./routes/Play";
import { Results } from "./routes/Results";
import { Replay } from "./routes/Replay";
import { BuilderPage } from "./routes/Builder";
import { SetupPage } from "./routes/Setup";
import { InspectorPage } from "./routes/Inspector";

export function App() {
  return (
    <>
    <StatusPopover />
    <ErrorBoundary>
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/play/:code" element={<Play />} />
      <Route path="/results/:sessionId" element={<Results />} />
      <Route path="/replay/:sessionId" element={<Replay />} />
      <Route path="/builder" element={<BuilderPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="/inspector/:sessionId" element={<InspectorPage />} />
      {import.meta.env.DEV && <Route path="/preview3d" element={<Preview3D />} />}
      <Route path="*" element={<p className="p-6">Page not found. <a className="underline" href="/">Home</a></p>} />
    </Routes>
    </ErrorBoundary>
    </>
  );
}

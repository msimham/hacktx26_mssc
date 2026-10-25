import { Route, Routes } from "react-router-dom";
import { StatusPopover } from "./components/StatusPopover";
import { Home } from "./routes/Home";
import { Play } from "./routes/Play";
import { Results } from "./routes/Results";
import { Replay } from "./routes/Replay";
import { BuilderPage } from "./routes/Builder";
import { SetupPage } from "./routes/Setup";

export function App() {
  return (
    <>
    <StatusPopover />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/play/:code" element={<Play />} />
      <Route path="/results/:sessionId" element={<Results />} />
      <Route path="/replay/:sessionId" element={<Replay />} />
      <Route path="/builder" element={<BuilderPage />} />
      <Route path="/setup" element={<SetupPage />} />
      <Route path="*" element={<p className="p-6">Page not found. <a className="underline" href="/">Home</a></p>} />
    </Routes>
    </>
  );
}

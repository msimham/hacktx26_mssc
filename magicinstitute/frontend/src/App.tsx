import { Route, Routes } from "react-router-dom";
import { Home } from "./Home";
import { CreateTraining } from "./CreateTraining";

/** TALE is the home page; the wizard's answers go to the platform API, which builds the world the player opens. */
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateTraining />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

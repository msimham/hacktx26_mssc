import { Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home";
import { CreateTraining } from "./routes/CreateTraining";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateTraining />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}

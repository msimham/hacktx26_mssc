import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CreateTraining } from "./CreateTraining";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CreateTraining />
  </StrictMode>,
);

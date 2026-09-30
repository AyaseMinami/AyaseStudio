import React from "react";
import ReactDOM from "react-dom/client";
import { BackupApp } from "./backup/BackupApp";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BackupApp />
  </React.StrictMode>,
);

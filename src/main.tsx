import React from "react";
import ReactDOM from "react-dom/client";
import { BackupApp } from "./backup/BackupApp";
import { installScrollbarAutoHide } from "./ui/scrollbarAutoHide";

const disposeScrollbars = installScrollbarAutoHide(document);
if (import.meta.hot) import.meta.hot.dispose(disposeScrollbars);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <BackupApp />
  </React.StrictMode>,
);

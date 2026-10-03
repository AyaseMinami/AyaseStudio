import { createRoot } from "react-dom/client";
import { installTrayAppearance } from "./appearance";
import { TrayMenu } from "./TrayMenu";
import "./tray.css";

const disposeAppearance = installTrayAppearance();
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);
createRoot(document.getElementById("root")!).render(<TrayMenu />);

import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { useConfirmation } from "../../src/ui/useConfirmation";
import "../../src/App.css";

// Exercise the real top-layer dialog with the application's Tailwind reset.
// This fixture has no repositories, credentials or native/provider calls.
function PositionRegression() {
  const { confirm, dialog } = useConfirmation();
  const [report, setReport] = useState("等待打开确认框");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => {
    if (!dialog) return;
    const measure = () => {
      const element = document.querySelector<HTMLDialogElement>(".confirmation-dialog");
      if (!element?.open) return;
      const rect = element.getBoundingClientRect();
      const dx = Math.abs(rect.x + rect.width / 2 - innerWidth / 2);
      const dy = Math.abs(rect.y + rect.height / 2 - innerHeight / 2);
      const contained = rect.left >= 15 && rect.top >= 15
        && rect.right <= innerWidth - 15 && rect.bottom <= innerHeight - 15;
      setReport(`${dx <= 1 && dy <= 1 && contained ? "PASS" : "FAIL"}: ${innerWidth}×${innerHeight}, center offset ${dx.toFixed(2)}, ${dy.toFixed(2)}, contained ${contained}`);
    };
    const frame = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure); };
  }, [dialog]);
  return <main style={{ padding: 24 }}>
    <h1>确认框定位回归</h1>
    <p role="status">{report}</p>
    <button onClick={() => setTheme(theme === "light" ? "dark" : "light")}>切换主题（当前 {theme}）</button>
    <button onClick={() => { void confirm({ title: "退出应用", message: "确定退出 Ayase Studio？退出后应用将停止运行。", confirmLabel: "退出",
      checkbox: { label: "不再提醒", onChange: () => {} } }); }}>打开退出确认</button>
    <button onClick={() => { void confirm({ title: "长内容确认", message: "较长说明，用于检查小窗口中的内部滚动与居中。\n".repeat(40), danger: true }); }}>打开长内容确认</button>
    {dialog}
  </main>;
}
createRoot(document.getElementById("root")!).render(<StrictMode><PositionRegression /></StrictMode>);

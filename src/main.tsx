import { createRoot } from "react-dom/client";
import App from "./App.tsx";

const root = document.getElementById("root")!;
const start = () => createRoot(root).render(<App />);
// The home page arrives with its first screen already in the HTML (api/landing.ts). Starting React
// straight away keeps the browser busy, so nothing shows until the app has run: let that HTML paint
// first (the timeout runs after the frame the animation callback belongs to), then start the app.
if (root.firstChild) requestAnimationFrame(() => setTimeout(start, 0));
else start();

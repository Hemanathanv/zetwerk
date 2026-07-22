import { createRoot } from "react-dom/client";
import App from "./App";
import { resolveApiUrl } from "@/lib/apiBase";
import "./index.css";

const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string" && input.startsWith("/api/")) {
    return nativeFetch(resolveApiUrl(input), init);
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(<App />);

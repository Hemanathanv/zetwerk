import { createRoot } from "react-dom/client";
import App from "./App";
import { resolveApiUrl } from "@/lib/apiBase";
import "./index.css";

const nativeFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  if (typeof input === "string") {
    if (input.startsWith("/api") || /^https?:\/\//i.test(input)) {
      return nativeFetch(resolveApiUrl(input), init);
    }
    return nativeFetch(input, init);
  }
  if (input instanceof URL) {
    return nativeFetch(resolveApiUrl(input.toString()), init);
  }
  if (input instanceof Request) {
    const resolvedUrl = resolveApiUrl(input.url);
    if (resolvedUrl !== input.url) {
      return nativeFetch(new Request(resolvedUrl, input), init);
    }
  }
  return nativeFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById("root")!).render(<App />);

import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import App from "./App.jsx";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

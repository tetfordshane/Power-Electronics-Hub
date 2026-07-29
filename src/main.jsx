import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "katex/dist/katex.min.css";
import PowerStage from "./PowerStage.jsx";
import "./global.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <PowerStage />
  </React.StrictMode>
);

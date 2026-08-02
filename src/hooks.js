import { useState, useEffect } from "react";

/* Reads the OS motion preference and keeps listening, so toggling it in
   system settings takes effect without a reload. */
function usePrefersReducedMotion() {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = (e) => setReduce(e.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => (mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on));
  }, []);
  return reduce;
}

export { usePrefersReducedMotion };

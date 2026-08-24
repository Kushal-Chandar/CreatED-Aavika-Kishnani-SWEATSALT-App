import { useEffect, useRef, useState } from "react";
import { animate, useReducedMotion } from "framer-motion";

export function useAnimatedNumber(target: number | undefined): number | undefined {
  const [display, setDisplay] = useState<number | undefined>(target);
  const prefersReducedMotion = useReducedMotion();
  const hasShownValue = useRef(target !== undefined);

  useEffect(() => {
    if (target === undefined) {
      setDisplay(undefined);
      hasShownValue.current = false;
      return;
    }

    if (prefersReducedMotion || !hasShownValue.current) {
      setDisplay(target);
      hasShownValue.current = true;
      return;
    }

    const controls = animate(display ?? target, target, {
      duration: 0.6,
      ease: "easeOut",
      onUpdate: setDisplay,
    });
    hasShownValue.current = true;
    return () => controls.stop();
    // `display` is read only to seed the animation's starting point — including
    // it in the deps would restart the animation on every frame it produces.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, prefersReducedMotion]);

  return display;
}

import { UNSAFE_NavigationContext } from "react-router-dom";
import { useContext, useEffect } from "react";

// Currently not working

const useBlocker = (blocker: () => boolean, when = true) => {
  const { navigator } = useContext(UNSAFE_NavigationContext);

  useEffect(() => {
    if (!when) return;

    const push = navigator.push;
    const replace = navigator.replace;

    navigator.push = (...args) => {
      if (blocker()) return; // block navigation
      push(...args);
    };

    navigator.replace = (...args) => {
      if (blocker()) return;
      replace(...args);
    };

    return () => {
      navigator.push = push;
      navigator.replace = replace;
    };
  }, [navigator, blocker, when]);
};

export default useBlocker;

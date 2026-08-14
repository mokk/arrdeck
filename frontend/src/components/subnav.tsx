import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export interface SubnavState {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}

const SubnavContext = createContext<{
  subnav: SubnavState | null;
  setSubnav: (state: SubnavState | null) => void;
}>({ subnav: null, setSubnav: () => {} });

export function SubnavProvider({ children }: { children: ReactNode }) {
  const [subnav, setSubnav] = useState<SubnavState | null>(null);
  return (
    <SubnavContext.Provider value={{ subnav, setSubnav }}>{children}</SubnavContext.Provider>
  );
}

export const useSubnav = () => useContext(SubnavContext);

/** Pages call this to dock their section switcher above the bottom tab bar.
 * Hidden automatically when fewer than two options are given. */
export function useRegisterSubnav(
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
) {
  const { setSubnav } = useContext(SubnavContext);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const optionsKey = options.map((o) => `${o.value}:${o.label}`).join("|");

  useEffect(() => {
    if (options.length < 2) {
      setSubnav(null);
      return;
    }
    setSubnav({ options, value, onChange: (v) => onChangeRef.current(v) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionsKey, value, setSubnav]);

  useEffect(() => () => setSubnav(null), [setSubnav]);
}

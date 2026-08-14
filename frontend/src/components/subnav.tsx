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

export interface SearchbarState {
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** submit-style searches (Enter / keyboard "go"); omit for live filters */
  onSubmit?: () => void;
  /** invoked by the clear button; defaults to onChange("") */
  onClear?: () => void;
}

const SubnavContext = createContext<{
  subnav: SubnavState | null;
  setSubnav: (state: SubnavState | null) => void;
  searchbar: SearchbarState | null;
  setSearchbar: (state: SearchbarState | null) => void;
}>({ subnav: null, setSubnav: () => {}, searchbar: null, setSearchbar: () => {} });

export function SubnavProvider({ children }: { children: ReactNode }) {
  const [subnav, setSubnav] = useState<SubnavState | null>(null);
  const [searchbar, setSearchbar] = useState<SearchbarState | null>(null);
  return (
    <SubnavContext.Provider value={{ subnav, setSubnav, searchbar, setSearchbar }}>
      {children}
    </SubnavContext.Provider>
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

/** Pages call this to float their search/filter input above the bottom dock. */
export function useRegisterSearchbar(
  placeholder: string,
  value: string,
  onChange: (value: string) => void,
  onSubmit?: () => void,
  onClear?: () => void,
) {
  const { setSearchbar } = useContext(SubnavContext);
  const refs = useRef({ onChange, onSubmit, onClear });
  refs.current = { onChange, onSubmit, onClear };

  useEffect(() => {
    setSearchbar({
      placeholder,
      value,
      onChange: (v) => refs.current.onChange(v),
      onSubmit: onSubmit ? () => refs.current.onSubmit?.() : undefined,
      onClear: () => (refs.current.onClear ?? (() => refs.current.onChange("")))(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder, value, Boolean(onSubmit), setSearchbar]);

  useEffect(() => () => setSearchbar(null), [setSearchbar]);
}

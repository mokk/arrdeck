import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";

export interface SubnavState {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  /** custom entrypoint reset (re-tap on the active tab); defaults to
   * selecting the first option */
  onReset?: () => void;
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
  sortButton: { open: () => void } | null;
  setSortButton: (state: { open: () => void } | null) => void;
}>({
  subnav: null,
  setSubnav: () => {},
  searchbar: null,
  setSearchbar: () => {},
  sortButton: null,
  setSortButton: () => {},
});

export function SubnavProvider({ children }: { children: ReactNode }) {
  const [subnav, setSubnav] = useState<SubnavState | null>(null);
  const [searchbar, setSearchbar] = useState<SearchbarState | null>(null);
  const [sortButton, setSortButton] = useState<{ open: () => void } | null>(null);
  return (
    <SubnavContext.Provider
      value={{ subnav, setSubnav, searchbar, setSearchbar, sortButton, setSortButton }}
    >
      {children}
    </SubnavContext.Provider>
  );
}

export const useSubnav = () => useContext(SubnavContext);

/** Pages call this to dock their section switcher (or action buttons) above
 * the bottom tab bar. Hidden automatically with fewer than two options. */
export function useRegisterSubnav(
  options: { value: string; label: string }[],
  value: string,
  onChange: (value: string) => void,
  onReset?: () => void,
) {
  const { setSubnav } = useContext(SubnavContext);
  const refs = useRef({ onChange, onReset });
  refs.current = { onChange, onReset };
  // A string key, not the array itself: `options` is a fresh literal on every
  // render, so depending on it re-runs the effect forever (setSubnav ->
  // re-render -> effect). Same for the onReset closure.
  const optionsKey = options.map((o) => `${o.value}:${o.label}`).join("|");

  // optionsKey and Boolean(onReset) stand in for values that change identity
  // every render. Listing the real ones re-runs the effect forever: setSubnav
  // re-renders, which builds a fresh options array, which re-runs the effect.
  // biome-ignore lint/correctness/useExhaustiveDependencies: real deps loop
  useEffect(() => {
    if (options.length < 2) {
      setSubnav(null);
      return;
    }
    setSubnav({
      options,
      value,
      onChange: (v) => refs.current.onChange(v),
      onReset: onReset ? () => refs.current.onReset?.() : undefined,
    });
  }, [optionsKey, value, Boolean(onReset), setSubnav]);

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

  // onSubmit is a new closure each render; Boolean() keeps the dep stable and
  // the call itself goes through refs, so the latest closure is always used.
  // biome-ignore lint/correctness/useExhaustiveDependencies: closure via ref
  useEffect(() => {
    setSearchbar({
      placeholder,
      value,
      onChange: (v) => refs.current.onChange(v),
      onSubmit: onSubmit ? () => refs.current.onSubmit?.() : undefined,
      onClear: () => (refs.current.onClear ?? (() => refs.current.onChange("")))(),
    });
  }, [placeholder, value, Boolean(onSubmit), setSearchbar]);

  useEffect(() => () => setSearchbar(null), [setSearchbar]);
}

/** Pages call this to float a sort/filter button next to the search bar;
 * the page renders its own drawer when `open` fires. */
export function useRegisterSortButton(open: () => void) {
  const { setSortButton } = useContext(SubnavContext);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    setSortButton({ open: () => openRef.current() });
    return () => setSortButton(null);
  }, [setSortButton]);
}

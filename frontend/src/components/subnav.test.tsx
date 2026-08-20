import { render } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SubnavProvider, useRegisterSubnav, useSubnav } from "./subnav";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

/** A dependency-array rewrite once turned these registrations into an infinite
 * setState loop: `options` is a fresh array literal on every render, so
 * depending on it re-runs the effect, which re-renders, forever. React bailed
 * out with error #185 and every tab stopped navigating. */

let renders = 0;

function Consumer({ value }: { value: string }) {
  renders += 1;
  // bail out loudly rather than letting a loop exhaust the heap, which is what
  // an unbounded version of this test does
  if (renders > 50) throw new Error(`render loop: ${renders} renders`);
  // both are new identities on each render, exactly as real callers write them
  useRegisterSubnav(
    [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ],
    value,
    () => {},
    () => {},
  );
  return null;
}

function Harness() {
  const [value] = useState("a");
  return <Consumer value={value} />;
}

describe("useRegisterSubnav", () => {
  it("settles instead of re-rendering forever", () => {
    renders = 0;
    render(
      <SubnavProvider>
        <Harness />
      </SubnavProvider>,
    );
    // a loop would run into the hundreds before React bailed out
    expect(renders).toBeLessThan(10);
  });

  it("still publishes the options it was given", () => {
    let seen: string[] = [];
    function Reader() {
      const { subnav } = useSubnav();
      seen = (subnav?.options ?? []).map((o) => o.value);
      return null;
    }
    render(
      <SubnavProvider>
        <Harness />
        <Reader />
      </SubnavProvider>,
    );
    expect(seen).toEqual(["a", "b"]);
  });
});

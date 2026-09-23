import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string, o?: { action?: string }) => o?.action ?? key }),
  // media.tsx pulls in the i18n setup, which registers this plugin
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

import { setPref } from "../lib/prefs";
import { ConfirmProvider, useConfirm } from "./Confirm";

function Probe({
  destructive,
  onResult,
}: {
  destructive: boolean;
  onResult: (ok: boolean) => void;
}) {
  const confirm = useConfirm();
  return (
    <button
      type="button"
      onClick={async () => onResult(await confirm({ action: "Go", destructive }))}
    >
      trigger
    </button>
  );
}

const run = (destructive: boolean) => {
  const onResult = vi.fn();
  render(
    <ConfirmProvider>
      <Probe destructive={destructive} onResult={onResult} />
    </ConfirmProvider>,
  );
  fireEvent.click(screen.getByText("trigger"));
  return onResult;
};

describe("confirm policy", () => {
  afterEach(() => localStorage.removeItem("prefs.confirm"));

  it("lets ordinary actions through when only deletes ask", async () => {
    setPref("confirm", "deletes");
    const onResult = run(false);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });

  it("asks before a delete, and cancel means no", async () => {
    setPref("confirm", "deletes");
    const onResult = run(true);
    await act(async () => {});
    expect(onResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("common.cancel"));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });

  it("never asks when told not to", async () => {
    setPref("confirm", "never");
    const onResult = run(true);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
  });
});

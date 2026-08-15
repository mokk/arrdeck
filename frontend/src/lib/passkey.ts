import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { api } from "../api/client";

export async function loginWithPasskey(): Promise<void> {
  const options = await api.post<Record<string, unknown>>("/auth/login/options");
  const credential = await startAuthentication({
    optionsJSON: options as never,
  });
  await api.post<void>("/auth/login/verify", { credential });
}

export async function registerPasskey(name: string, code = ""): Promise<void> {
  const options = await api.post<Record<string, unknown>>("/auth/register/options", { code });
  const credential = await startRegistration({
    optionsJSON: options as never,
  });
  await api.post<void>("/auth/register/verify", { credential, name, code });
}

export const passkeysSupported = () =>
  typeof window !== "undefined" &&
  window.isSecureContext &&
  "PublicKeyCredential" in window;

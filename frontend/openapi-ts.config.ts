// Plain object (no defineConfig import): the CLI runs from an npx sandbox with
// its own JS TypeScript 5.x, since the Go-native TS 7 lacks the compiler API
// hey-api drives. See the gen:api script in package.json.
export default {
  // The committed spec, not a live URL. Reading the running server meant a
  // backend change could not be typed until it was deployed — regenerate the
  // spec first with: python backend/scripts/export_openapi.py
  input: "../openapi.json",
  output: "src/api/generated",
  // types only — the app has its own thin fetch wrapper in src/api/client.ts
  plugins: ["@hey-api/typescript"],
};

// Plain object (no defineConfig import): the CLI runs from an npx sandbox with
// its own JS TypeScript 5.x, since the Go-native TS 7 lacks the compiler API
// hey-api drives. See the gen:api script in package.json.
export default {
  input: "http://10.0.0.154:3500/openapi.json",
  output: "src/api/generated",
  // types only — the app has its own thin fetch wrapper in src/api/client.ts
  plugins: ["@hey-api/typescript"],
};

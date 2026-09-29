/** esbuild inlines `.svg` imports as text (scripts/build.mjs). */
declare module '*.svg' {
  const text: string;
  export default text;
}

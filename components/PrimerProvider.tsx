"use client";

/**
 * Primer design system provider.
 * Wraps the app with ThemeProvider and BaseStyles for GitHub-style components.
 * See: https://primer.style/react/getting-started/
 */

import "@primer/primitives/dist/css/functional/themes/light.css";
import { BaseStyles, ThemeProvider } from "@primer/react";

export function PrimerProvider({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <BaseStyles>{children}</BaseStyles>
    </ThemeProvider>
  );
}

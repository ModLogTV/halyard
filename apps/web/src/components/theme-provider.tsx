import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes'
import type { ReactNode } from 'react'

/**
 * Light and dark mode. next-themes stores the choice in localStorage and sets the
 * `dark` class on <html>; the inline script it injects prevents a flash on load.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}

export { useTheme }

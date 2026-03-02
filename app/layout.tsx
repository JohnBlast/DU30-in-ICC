import type { Metadata } from "next";
import "./globals.css";
import { PrimerProvider } from "@/components/PrimerProvider";

export const metadata: Metadata = {
  title: "The Docket",
  description: "ICC Philippines Case Q&A",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full">
      <body className="flex h-screen min-h-screen flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <PrimerProvider>
            <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
            <footer className="flex-shrink-0 border-t border-gray-200 bg-gray-50 px-4 py-2 text-center text-[11px] text-gray-500">
              <p className="leading-tight">This is an independent AI tool. Not affiliated with or endorsed by the International Criminal Court. Not legal advice — consult a qualified attorney.</p>
            </footer>
          </PrimerProvider>
        </div>
      </body>
    </html>
  );
}

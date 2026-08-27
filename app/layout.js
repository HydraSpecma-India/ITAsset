import "./globals.css";
import { AuthProvider } from "@/lib/session";
import { DeptProvider } from "@/lib/department";

export const metadata = {
  title: "Department Purchase & Budget Monitor",
  description: "Track department purchases, assets, expiries and budget consumption",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <AuthProvider>
          <DeptProvider>{children}</DeptProvider>
        </AuthProvider>
      </body>
    </html>
  );
}

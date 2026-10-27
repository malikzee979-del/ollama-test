import "./marketing.css";

/* Favicon + theme-color live in metadata/viewport — the App Router injects
   <head> itself; a manual <head> in the layout broke prerendering. */
export const metadata = {
  title: "Local Theft Auto — a whole city, zero network, one browser tab",
  description:
    "Local Theft Auto: a top-down GTA-style city that runs entirely in your browser. Steal cars, run heists, dodge a five-star police response — nothing leaves your machine, not even your crimes.",
  icons: {
    icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='9' fill='%23ffb224'/%3E%3C/svg%3E",
  },
};

export const viewport = {
  themeColor: "#07090d",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body id="top">{children}</body>
    </html>
  );
}

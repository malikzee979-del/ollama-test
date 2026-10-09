import "./marketing.css";

export const metadata = {
  title: "Local Theft Auto — a whole city, zero network, one browser tab",
  description:
    "Local Theft Auto: a top-down GTA-style city that runs entirely in your browser. Steal cars, run heists, dodge a five-star police response — nothing leaves your machine, not even your crimes.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='9' fill='%23ffb224'/%3E%3C/svg%3E" />
        <meta name="theme-color" content="#07090d" />
      </head>
      <body id="top">{children}</body>
    </html>
  );
}

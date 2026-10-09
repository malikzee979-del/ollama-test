import { Nav, Footer, BackgroundFx, ChatWidget } from "./Chrome";

/* Shared shell for the 8 feature pages + about. Content comes in as the
   original page's <main> inner HTML, kept verbatim so marketing.css styles
   it unchanged. dangerouslySetInnerHTML is safe here: the markup is
   project-authored, static at build time, and never user-input. */
export default function FeaturePage({ title, description, html }) {
  return (
    <>
      <BackgroundFx />
      <Nav />
      <main id="main" dangerouslySetInnerHTML={{ __html: html }} />
      <div className="street-thread" aria-hidden="true"><i /></div>
      <Footer />
      <ChatWidget />
    </>
  );
}

export const featureMetadata = (title, description) => ({ title, description, metadataBase: undefined });

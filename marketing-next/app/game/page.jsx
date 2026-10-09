import { Footer, ChatWidget } from "../components/Chrome";
import GameMount from "./GameMount";

export const metadata = {
  title: "Play Local Theft Auto — live in your browser",
  description: "Play Local Theft Auto right now: a top-down GTA-style city that runs entirely in your browser.",
};

/* The game page keeps the original game.js + assets.js byte-for-byte —
   they are plain scripts (an IIFE with zero exports) that expect the
   game.html markup at load time, so this page reproduces that shell
   exactly and GameMount injects the scripts on the client. React never
   owns the game's DOM. */
export default function Game() {
  return (
    <>
      <GameMount />
      <div className="street-thread" aria-hidden="true"><i /></div>
      <Footer />
      <ChatWidget />
    </>
  );
}

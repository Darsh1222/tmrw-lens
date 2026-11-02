import { Cinzel, Instrument_Sans, Noto_Serif_Display } from "next/font/google";

// Tomorrow's "Forum" faces, for every Lens screen: Instrument Sans for
// the interface, Noto Serif Display narrowed on its width axis for the title,
// Cinzel for the one small-caps label. Self-hosted by next/font, latin only.

export const forumSans = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-forum-sans" });
export const forumDisplay = Noto_Serif_Display({
  subsets: ["latin"],
  // Variable: weight 500 and width 87.5 are set in CSS (.forum-display).
  axes: ["wdth"],
  variable: "--font-forum-display",
});
export const forumCaps = Cinzel({
  subsets: ["latin"],
  weight: "500",
  variable: "--font-forum-caps",
  display: "optional",
});

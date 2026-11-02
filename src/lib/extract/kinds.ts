import type { SourceKind } from "@/lib/schemas/evidence";

/** How each kind of input is named to people: "From your whiteboard photo". */
export const KIND_LABEL: Record<SourceKind, string> = {
  testudo_screenshot: "Testudo schedule",
  testudo_text: "pasted Testudo schedule",
  syllabus_pdf: "syllabus",
  whiteboard_photo: "whiteboard photo",
  notes_photo: "notes photo",
  lms_screenshot: "course site screenshot",
};

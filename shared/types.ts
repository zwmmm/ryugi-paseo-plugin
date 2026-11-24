export type ArtifactKind = "document" | "artboard" | "whiteboard";

export interface RyugiCommentThread {
  id: string;
  artifactKind: ArtifactKind;
  artifactId: string;
  targetId: string; // e.g. "block-2" or "board-A#node-1"
  targetName: string;
  quote?: string;
  text: string;
  author: "human" | "agent";
  createdAt: string;
  resolved: boolean;
}

export interface DocumentBlock {
  id: string;
  tag: "h1" | "h2" | "p" | "code" | "ask";
  text: string;
  askOptions?: string[]; // for embedded questions
  selectedOption?: string;
  line: number;
}

export interface DocumentArtifact {
  id: string;
  title: string;
  blocks: DocumentBlock[];
}

export interface ArtboardElement {
  id: string;
  tag: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  text?: string;
  status: "idle" | "feedback" | "pass" | "reject";
}

export interface ArtboardVariant {
  id: string;
  name: string;
  description: string;
  elements: ArtboardElement[];
}

export interface ArtboardArtifact {
  id: string;
  title: string;
  variants: ArtboardVariant[];
}

export const artifactFiles = {
  document: "doc.xml",
  artboard: "canvas.json",
  html: "index.html",
  slides: "index.html",
  whiteboard: "scene.excalidraw",
  verify: "verify.xml",
  report: "report.tsx",
  storyboard: "storyboard.xml",
} as const;

export type ArtifactType = keyof typeof artifactFiles;
export const artifactTypes = Object.keys(artifactFiles) as ArtifactType[];

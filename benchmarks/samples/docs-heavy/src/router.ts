import { docsSearchIndex } from "./search";
import navigation from "../config/navigation.yaml";

export function registerDocsRoutes(app: { get: (route: string, handler: unknown) => void }) {
  app.get("/docs/architecture", docsSearchIndex);
  app.get("/docs/runbook", docsSearchIndex);
}

export { navigation };

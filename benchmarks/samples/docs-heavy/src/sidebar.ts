import navigation from "../config/navigation.yaml";

export function docsSidebar() {
  return navigation.sections.map((section: { id: string; href: string }) => ({
    label: section.id,
    href: section.href,
  }));
}

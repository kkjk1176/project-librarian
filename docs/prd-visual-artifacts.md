# PRD Visual Artifacts

Project Librarian treats complex PRD visuals as first-class HTML artifacts. Markdown remains the durable route for metadata, requirements, rationale, decisions, and text summaries; HTML carries the canonical visual presentation.

## Supported visual catalog

| Visual type | Typical PRD area | Primary question |
| --- | --- | --- |
| Journey map | `01-discovery` | What does the user experience across the whole journey? |
| Ecosystem/stakeholder map | `01-discovery` | Which people, systems, and incentives surround the problem? |
| User flow | `02-requirements` | What paths, branches, and completion or drop-off points exist? |
| Service blueprint/swimlane | `02-requirements` or `06-operations` | Who owns each user-facing and backstage step? |
| Permission matrix | `02-requirements` | Which roles can view or change each capability? |
| System context/architecture | `03-design` | What are the system boundaries, components, and data flows? |
| Sequence diagram | `03-design` | What happens over time between actors, services, and events? |
| State machine | `03-design` | Which states, transitions, guards, and recovery paths exist? |
| Screen flow/wireframes | `03-design` | What does the user see and how do screens connect? |
| Domain/data model | `03-design` | Which entities, relationships, ownership, and lifecycles matter? |
| Dependency/rollout map | `04-delivery` or `08-roadmap` | What must happen first and how is the change released safely? |
| Experiment flow/funnel | `05-validation` or `07-metrics` | Where do users convert, fail, or differ between variants? |
| KPI tree/cohort view | `07-metrics` | How do outcomes decompose and change across segments or time? |
| Decision-impact map | `09-decisions` | Which product, technical, or team surfaces does a decision affect? |
| Evidence map | `10-sources` | Which research and sources support each claim or decision? |

The catalog is not limited to a starter subset. Use every type that materially improves understanding of the PRD; do not create empty visuals just to fill the catalog.

## Storage and routing

Place the HTML file under the owning service, PRD, and document area:

```text
wiki/10-services/<service>/prds/<PRD-ID-slug>/03-design/
  index.md
  visuals/
    system-architecture.html
    state-machine.html
```

Use the corresponding area for discovery, requirements, validation, operations, metrics, roadmap, decisions, or sources rather than putting every visual in `03-design/`. Link each file from the area `index.md` or the focused Markdown artifact. Keep stable, descriptive names such as `checkout-user-flow.html` or `payment-rollout-map.html`.

## HTML artifact contract

Every canonical PRD visual must:

- be a self-contained `.html` file with a meaningful `<title>` and heading;
- state its purpose, scope, owner, and updated date;
- include a text summary or equivalent accessible representation;
- include a legend when symbols, colors, or line styles carry meaning;
- be responsive, printable, keyboard-navigable, and understandable without color alone;
- use inline CSS/SVG or repository-local assets instead of external CDN dependencies;
- link to the related requirements, decisions, and source evidence with stable relative links;
- show the current/future state boundary and unresolved assumptions when they affect interpretation.

The Markdown route remains the source of truth for frontmatter, rationale, acceptance criteria, decisions, and evidence summaries. Update the Markdown route and HTML visual in the same change when the underlying product behavior changes. Mermaid or ASCII diagrams may be used for a small inline explanation, but they are not the canonical artifact for a supported PRD visual.

## Review checklist

Before considering a visual complete, confirm:

1. The visual answers a concrete PRD question that prose or a small table does not answer as clearly.
2. Every node, actor, state, transition, and dependency has an unambiguous label.
3. The visual agrees with the linked requirements and decision documents.
4. An agent can understand the main conclusion from the text summary without rendering the HTML.
5. Links, references, and the review trigger are still valid.

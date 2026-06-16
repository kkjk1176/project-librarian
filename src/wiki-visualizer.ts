import * as path from "node:path";
import { conceptFromPage, type WikiConcept } from "./wiki-concepts";
import { buildWikiGraph, wikiRouterDepths, type WikiGraph, type WikiPageInput } from "./wiki-graph";
import { wikiMarkdownFiles } from "./wiki-files";
import { normalizePath, read, root, write } from "./workspace";

export interface WikiVisualizerNode {
  brokenLinks: string[];
  budget: string;
  decisionRefCount: number;
  description: string;
  file: string;
  incomingCount: number;
  outgoingCount: number;
  reviewTrigger: string;
  routerDepth: number | null;
  scope: string;
  status: string;
  timestamp: string;
  title: string;
  type: string;
}

export interface WikiVisualizerEdge {
  kind: "link" | "decision_ref";
  source: string;
  target: string;
}

export interface WikiVisualizerPayload {
  generatedAt: string;
  nodes: WikiVisualizerNode[];
  edges: WikiVisualizerEdge[];
  summary: {
    brokenCount: number;
    edgeCount: number;
    nodeCount: number;
    orphanCount: number;
    typeCount: number;
    unreachableCount: number;
  };
}

export const defaultWikiVisualizerOutput = ".project-wiki/wiki-graph.html";

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function visualizerEdges(graph: WikiGraph, pages: WikiPageInput[]): WikiVisualizerEdge[] {
  const linkEdges = graph.links
    .filter((link) => graph.files.has(link.normalizedTarget))
    .map((link) => ({ kind: "link" as const, source: link.file, target: link.normalizedTarget }));
  const decisionRefEdges: WikiVisualizerEdge[] = [];
  for (const page of pages) {
    const ref = graph.outgoingDecisionRef.get(page.file);
    if (ref && graph.files.has(ref)) decisionRefEdges.push({ kind: "decision_ref", source: page.file, target: ref });
  }
  return [...linkEdges, ...decisionRefEdges].sort((a, b) => a.source.localeCompare(b.source) || a.target.localeCompare(b.target) || a.kind.localeCompare(b.kind));
}

function brokenLinksFor(graph: WikiGraph, file: string): string[] {
  return uniqueSorted((graph.outgoingLinks.get(file) ?? []).map((link) => link.normalizedTarget).filter((target) => !graph.files.has(target)));
}

export function buildWikiVisualizerPayload(pages: WikiPageInput[], generatedAt: string = new Date().toISOString()): WikiVisualizerPayload {
  const graph = buildWikiGraph(pages);
  const depths = wikiRouterDepths(graph);
  const conceptByFile = new Map<string, WikiConcept>(pages.map((page) => [page.file, conceptFromPage(page.file, page.text)]));
  const edges = visualizerEdges(graph, pages);
  const nodes = pages.map((page) => {
    const concept = conceptByFile.get(page.file) as WikiConcept;
    const incomingCount = uniqueSorted((graph.incomingLinks.get(page.file) ?? []).map((link) => link.file)).length;
    const outgoingCount = uniqueSorted((graph.outgoingLinks.get(page.file) ?? []).map((link) => link.normalizedTarget).filter((target) => graph.files.has(target))).length;
    return {
      brokenLinks: brokenLinksFor(graph, page.file),
      budget: concept.budget,
      decisionRefCount: graph.incomingDecisionRefs.get(page.file)?.length ?? 0,
      description: concept.description,
      file: page.file,
      incomingCount,
      outgoingCount,
      reviewTrigger: concept.reviewTrigger,
      routerDepth: depths.get(page.file) ?? null,
      scope: concept.scope,
      status: concept.status,
      timestamp: concept.timestamp,
      title: concept.title,
      type: concept.type,
    };
  }).sort((a, b) => a.file.localeCompare(b.file));
  return {
    generatedAt,
    nodes,
    edges,
    summary: {
      brokenCount: nodes.filter((node) => node.brokenLinks.length > 0).length,
      edgeCount: edges.length,
      nodeCount: nodes.length,
      orphanCount: nodes.filter((node) => node.incomingCount === 0 && node.outgoingCount === 0).length,
      typeCount: new Set(nodes.map((node) => node.type)).size,
      unreachableCount: nodes.filter((node) => node.routerDepth === null).length,
    },
  };
}

function jsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<\u2028\u2029]/g, (ch) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0"));
}

function renderWikiVisualizerHtml(payload: WikiVisualizerPayload): string {
  const payloadJson = jsonForHtml(payload);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Project Librarian Wiki Graph</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f7f8fa; color: #16202a; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 20px; border-bottom: 1px solid #d9dee7; background: #ffffff; }
    h1 { margin: 0; font-size: 18px; font-weight: 700; }
    main { display: grid; grid-template-columns: minmax(280px, 360px) 1fr minmax(280px, 380px); height: calc(100vh - 65px); }
    aside, section { min-width: 0; }
    .panel { border-right: 1px solid #d9dee7; background: #ffffff; padding: 16px; overflow: auto; }
    .detail { border-left: 1px solid #d9dee7; border-right: 0; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: #516070; }
    .summary span { padding: 4px 7px; border: 1px solid #cfd6e1; border-radius: 6px; background: #f4f6f9; }
    .summary span.alert { border-color: #e0a3a3; background: #fbecec; color: #9a3b3b; }
    label { display: block; margin: 14px 0 6px; font-size: 12px; font-weight: 700; color: #394756; }
    input, select { width: 100%; padding: 8px 10px; border: 1px solid #bdc7d4; border-radius: 6px; background: #ffffff; font: inherit; font-size: 14px; }
    .list-meta { margin-top: 16px; font-size: 12px; color: #667484; }
    .panel.nav { overflow: hidden; display: flex; flex-direction: column; }
    .list { margin-top: 10px; display: grid; gap: 8px; flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    button.node { width: 100%; text-align: left; border: 1px solid #d8dee8; border-radius: 8px; background: #ffffff; padding: 10px; cursor: pointer; }
    button.node[aria-current="true"] { border-color: #2474b7; box-shadow: 0 0 0 2px rgba(36, 116, 183, 0.14); }
    .node-title { display: block; font-size: 14px; font-weight: 700; color: #152436; overflow-wrap: anywhere; }
    .node-meta { display: block; margin-top: 4px; font-size: 12px; color: #667484; overflow-wrap: anywhere; }
    .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
    .tag { font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 999px; border: 1px solid; }
    .tag.unreachable { color: #9a3b3b; border-color: #e0a3a3; background: #fbecec; }
    .tag.orphan { color: #8a6d1b; border-color: #e3cd8f; background: #faf3df; }
    .tag.broken { color: #9a3b3b; border-color: #e0a3a3; background: #fbecec; }
    .graph-wrap { position: relative; overflow: hidden; background: #f7f8fa; }
    svg { width: 100%; height: calc(100vh - 65px); display: block; touch-action: none; cursor: grab; }
    svg.panning { cursor: grabbing; }
    .node { cursor: pointer; }
    .edge { stroke: #aeb8c5; stroke-width: 1.2; marker-end: url(#arrow); vector-effect: non-scaling-stroke; }
    .edge.decision_ref { stroke: #9b5c8f; stroke-dasharray: 5 4; }
    .edge.dim { opacity: 0.1; }
    .edge.hi { stroke: #17212b; stroke-width: 2; opacity: 1; }
    .edge.path { stroke: #d08700; stroke-width: 2.6; opacity: 1; }
    .point { stroke: #ffffff; stroke-width: 2; cursor: pointer; }
    .point.selected { stroke: #17212b; stroke-width: 3; }
    .point.unreachable { stroke: #cc4b4b; stroke-dasharray: 3 2; }
    .point.dim { opacity: 0.18; }
    .badge { fill: #cc4b4b; pointer-events: none; }
    .label { font-size: 11px; fill: #2b3848; paint-order: stroke; stroke: #f7f8fa; stroke-width: 4; stroke-linejoin: round; pointer-events: none; }
    .label.hidden { display: none; }
    .controls { position: absolute; right: 12px; top: 12px; display: flex; gap: 6px; }
    .controls button { width: 30px; height: 30px; border: 1px solid #cfd6e1; border-radius: 6px; background: #ffffff; cursor: pointer; font-size: 16px; line-height: 1; color: #2b3848; }
    .controls button:hover { border-color: #2474b7; }
    .topbar { position: absolute; top: 12px; left: 12px; z-index: 2; display: flex; align-items: center; gap: 8px; background: rgba(255, 255, 255, 0.93); border: 1px solid #d9dee7; border-radius: 8px; padding: 6px 10px; }
    .topbar label { display: inline; margin: 0; font-size: 12px; color: #394756; }
    .topbar select { width: auto; }
    .legend { position: absolute; left: 12px; bottom: 12px; max-width: calc(100% - 24px); background: rgba(255, 255, 255, 0.93); border: 1px solid #d9dee7; border-radius: 8px; padding: 8px 10px; display: flex; flex-wrap: wrap; gap: 6px 12px; font-size: 11px; color: #435367; }
    .legend .k { display: flex; align-items: center; gap: 5px; }
    .legend .sw { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1px #cfd6e1; }
    .legend .sw.ring { background: #ffffff; border: 1.5px dashed #cc4b4b; box-shadow: none; }
    .legend .sw.dot { background: #cc4b4b; }
    .empty { position: absolute; inset: 0; display: grid; place-items: center; color: #617083; pointer-events: none; }
    .empty[hidden] { display: none; }
    .detail h2 { margin: 0 0 8px; font-size: 18px; overflow-wrap: anywhere; }
    .detail dl { display: grid; grid-template-columns: 92px 1fr; gap: 8px 10px; margin: 16px 0; font-size: 13px; }
    .detail dt { font-weight: 700; color: #435367; }
    .detail dd { margin: 0; color: #1d2a36; overflow-wrap: anywhere; }
    .links { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 6px; }
    button.link { display: block; width: 100%; text-align: left; padding: 6px 8px; border: 1px solid #d9dee7; border-radius: 6px; background: #f8fafc; cursor: pointer; font: inherit; font-size: 13px; overflow-wrap: anywhere; }
    button.link:hover { border-color: #2474b7; }
    .kind { color: #7a8696; font-size: 11px; }
    .links li { padding: 6px 8px; border: 1px solid #e0a3a3; border-radius: 6px; background: #fbecec; font-size: 13px; overflow-wrap: anywhere; }
    @media (max-width: 960px) { main { grid-template-columns: 1fr; height: auto; } .panel, .detail { border: 0; border-bottom: 1px solid #d9dee7; max-height: 44vh; } .panel.nav { display: block; overflow: auto; } .list { flex: none; overflow: visible; } svg { height: 56vh; } }
  </style>
</head>
<body>
  <header>
    <h1>Project Librarian Wiki Graph</h1>
    <div class="summary" id="summary"></div>
  </header>
  <main>
    <aside class="panel nav">
      <label for="search">Search</label>
      <input id="search" autocomplete="off" placeholder="Title, path, type, scope">
      <label for="group">Group by</label>
      <select id="group">
        <option value="type">Concept type</option>
        <option value="section">Section / folder</option>
        <option value="depth">Router depth</option>
        <option value="community">Link community</option>
      </select>
      <label for="type">Type</label>
      <select id="type"></select>
      <label for="hygiene">Hygiene</label>
      <select id="hygiene">
        <option value="all">All pages</option>
        <option value="unreachable">Unreachable</option>
        <option value="orphan">Orphan (no links)</option>
        <option value="broken">Broken links</option>
      </select>
      <div class="list-meta" id="list-meta"></div>
      <div class="list" id="list"></div>
    </aside>
    <section class="graph-wrap">
      <div class="topbar">
        <label for="depth">Router depth</label>
        <select id="depth">
          <option value="all">All depths</option>
          <option value="reachable">Reachable</option>
          <option value="unreachable">Unreachable</option>
        </select>
      </div>
      <svg id="graph" role="img" aria-label="Wiki graph"></svg>
      <div class="controls">
        <button id="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
        <button id="zoom-out" title="Zoom out" aria-label="Zoom out">&#8722;</button>
        <button id="zoom-reset" title="Reset view" aria-label="Reset view">&#8853;</button>
      </div>
      <div class="legend" id="legend"></div>
      <div class="empty" id="empty" hidden>No matching nodes</div>
    </section>
    <aside class="panel detail" id="detail"></aside>
  </main>
  <script id="wiki-graph-data" type="application/json">${payloadJson}</script>
  <script>
    var payload = JSON.parse(document.getElementById("wiki-graph-data").textContent);
    var state = { selected: "", query: "", type: "all", depth: "all", group: "type", hygiene: "all" };
    var view = { x: 0, y: 0, k: 1 };
    var neighborSet = new Set();
    var dragging = false, last = null, down = null, moved = false, downOnPoint = false;
    var HUB = 8;

    function escapeHtml(value) { return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]; }); }
    function escapeAttr(value) { return escapeHtml(value).replace(/"/g, "&quot;"); }

    var colorByType = new Map();
    var palette = ["#2f6f9f", "#5b7f3a", "#9a5f27", "#7b5aa6", "#bd4b4b", "#327d77", "#5d6f86", "#8b6f2b", "#6d7892"];
    function color(type) { if (!colorByType.has(type)) colorByType.set(type, palette[colorByType.size % palette.length]); return colorByType.get(type); }
    var sortedTypes = Array.from(new Set(payload.nodes.map(function (n) { return n.type; }))).sort();
    sortedTypes.forEach(function (t) { color(t); });

    var byFile = new Map(payload.nodes.map(function (n) { return [n.file, n]; }));

    function isUnreachable(n) { return n.routerDepth === null; }
    function isOrphan(n) { return n.incomingCount === 0 && n.outgoingCount === 0; }
    function isBroken(n) { return (n.brokenLinks || []).length > 0; }
    function degreeOf(n) { return n.incomingCount + n.outgoingCount; }
    function sectionOf(file) { var parts = String(file).split("/"); return parts.length > 2 ? parts[1] : "(root)"; }

    function computeCommunities(nodes, edges) {
      var adj = new Map();
      nodes.forEach(function (n) { adj.set(n.file, []); });
      edges.forEach(function (e) { if (adj.has(e.source) && adj.has(e.target)) { adj.get(e.source).push(e.target); adj.get(e.target).push(e.source); } });
      var label = new Map();
      nodes.forEach(function (n) { label.set(n.file, n.file); });
      var order = nodes.map(function (n) { return n.file; }).sort();
      for (var iter = 0; iter < 12; iter++) {
        var changed = false;
        for (var oi = 0; oi < order.length; oi++) {
          var f = order[oi];
          var nb = adj.get(f);
          if (!nb.length) continue;
          var counts = new Map();
          for (var j = 0; j < nb.length; j++) { var l = label.get(nb[j]); counts.set(l, (counts.get(l) || 0) + 1); }
          var pairs = Array.from(counts.keys()).sort().map(function (k) { return [k, counts.get(k)]; });
          var best = label.get(f), bestC = -1;
          for (var p = 0; p < pairs.length; p++) { if (pairs[p][1] > bestC) { bestC = pairs[p][1]; best = pairs[p][0]; } }
          if (best !== label.get(f)) { label.set(f, best); changed = true; }
        }
        if (!changed) break;
      }
      return label;
    }
    var community = computeCommunities(payload.nodes, payload.edges);
    function groupKey(n) {
      if (state.group === "section") return sectionOf(n.file);
      if (state.group === "depth") return isUnreachable(n) ? "unreachable" : "depth " + n.routerDepth;
      if (state.group === "community") return community.get(n.file) || "-";
      return n.type;
    }

    var summary = document.getElementById("summary");
    function chip(text, alert) { return '<span class="' + (alert ? "alert" : "") + '">' + escapeHtml(text) + "</span>"; }
    summary.innerHTML = [
      chip(payload.summary.nodeCount + " nodes", false),
      chip(payload.summary.edgeCount + " edges", false),
      chip(payload.summary.typeCount + " types", false),
      chip(payload.summary.unreachableCount + " unreachable", payload.summary.unreachableCount > 0),
      chip(payload.summary.orphanCount + " orphan", payload.summary.orphanCount > 0),
      chip(payload.summary.brokenCount + " broken", payload.summary.brokenCount > 0),
      chip("Generated " + payload.generatedAt, false)
    ].join("");

    var typeSelect = document.getElementById("type");
    typeSelect.innerHTML = '<option value="all">All types</option>' + sortedTypes.map(function (type) { return '<option value="' + escapeAttr(type) + '">' + escapeHtml(type) + "</option>"; }).join("");

    var legend = document.getElementById("legend");
    legend.innerHTML = sortedTypes.map(function (t) { return '<span class="k"><span class="sw" style="background:' + color(t) + '"></span>' + escapeHtml(t) + "</span>"; }).join("") +
      '<span class="k"><span class="sw ring"></span>unreachable</span>' +
      '<span class="k"><span class="sw dot"></span>broken link</span>';

    document.getElementById("search").addEventListener("input", function (event) { state.query = event.target.value.toLowerCase(); render(); });
    typeSelect.addEventListener("change", function (event) { state.type = event.target.value; render(); });
    document.getElementById("depth").addEventListener("change", function (event) { state.depth = event.target.value; render(); });
    document.getElementById("group").addEventListener("change", function (event) { state.group = event.target.value; view = { x: 0, y: 0, k: 1 }; render(); });
    document.getElementById("hygiene").addEventListener("change", function (event) { state.hygiene = event.target.value; render(); });
    document.getElementById("zoom-in").addEventListener("click", function () { zoomAtCenter(1.25); });
    document.getElementById("zoom-out").addEventListener("click", function () { zoomAtCenter(1 / 1.25); });
    document.getElementById("zoom-reset").addEventListener("click", function () { view = { x: 0, y: 0, k: 1 }; applyView(); });

    function matchHygiene(n) {
      if (state.hygiene === "unreachable") return isUnreachable(n);
      if (state.hygiene === "orphan") return isOrphan(n);
      if (state.hygiene === "broken") return isBroken(n);
      return true;
    }
    function filteredNodes() {
      return payload.nodes.filter(function (node) {
        var haystack = [node.file, node.title, node.type, node.scope, node.description].join(" ").toLowerCase();
        var typeOk = state.type === "all" || node.type === state.type;
        var depthOk = state.depth === "all" || (state.depth === "reachable" ? node.routerDepth !== null : node.routerDepth === null);
        return typeOk && depthOk && matchHygiene(node) && (!state.query || haystack.includes(state.query));
      });
    }

    function ringLayout(nodes, width, height) {
      var centerX = width / 2, centerY = height / 2;
      var byDepth = new Map();
      nodes.forEach(function (node) { var key = node.routerDepth === null ? "unreachable" : String(node.routerDepth); byDepth.set(key, (byDepth.get(key) || []).concat([node])); });
      var positions = new Map();
      var rings = Array.from(byDepth.keys()).sort(function (a, b) { return (a === "unreachable" ? 999 : Number(a)) - (b === "unreachable" ? 999 : Number(b)); });
      rings.forEach(function (ring, ringIndex) {
        var items = byDepth.get(ring);
        var radius = ring === "0" ? 0 : Math.min(width, height) * (0.13 + ringIndex * 0.09);
        items.forEach(function (node, index) {
          var angle = items.length === 1 ? -Math.PI / 2 : (Math.PI * 2 * index) / items.length - Math.PI / 2;
          positions.set(node.file, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
        });
      });
      return positions;
    }
    function clusterLayout(nodes, width, height) {
      var groups = new Map();
      nodes.forEach(function (n) { var k = groupKey(n); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); });
      var keys = Array.from(groups.keys()).sort();
      var cx = width / 2, cy = height / 2;
      var R = Math.min(width, height) * 0.38;
      var positions = new Map();
      keys.forEach(function (k, gi) {
        var items = groups.get(k).slice().sort(function (a, b) { return a.file < b.file ? -1 : 1; });
        var ga = keys.length === 1 ? 0 : (Math.PI * 2 * gi) / keys.length - Math.PI / 2;
        var gx = keys.length === 1 ? cx : cx + Math.cos(ga) * R;
        var gy = keys.length === 1 ? cy : cy + Math.sin(ga) * R;
        items.forEach(function (n, i) { var a = i * 2.399963229; var rr = 15 * Math.sqrt(i); positions.set(n.file, { x: gx + Math.cos(a) * rr, y: gy + Math.sin(a) * rr }); });
      });
      return positions;
    }
    function layout(nodes, width, height) { return state.group === "depth" ? ringLayout(nodes, width, height) : clusterLayout(nodes, width, height); }

    function rootFile() { var r = payload.nodes.find(function (n) { return n.routerDepth === 0; }); return r ? r.file : "wiki/startup.md"; }
    function pathTo(target) {
      var root = rootFile();
      if (!target || !byFile.has(target) || target === root) return [];
      var adj = new Map();
      payload.edges.forEach(function (e) { if (!adj.has(e.source)) adj.set(e.source, []); adj.get(e.source).push(e.target); });
      var queue = [root], prev = new Map([[root, null]]);
      while (queue.length) { var c = queue.shift(); if (c === target) break; var nx = adj.get(c) || []; for (var i = 0; i < nx.length; i++) { if (!prev.has(nx[i])) { prev.set(nx[i], c); queue.push(nx[i]); } } }
      if (!prev.has(target)) return [];
      var pathNodes = [], cur = target;
      while (cur != null) { pathNodes.unshift(cur); cur = prev.get(cur); }
      return pathNodes;
    }

    function applyView() {
      var vp = document.getElementById("viewport");
      if (!vp) return;
      vp.setAttribute("transform", "translate(" + view.x + "," + view.y + ") scale(" + view.k + ")");
      var inv = 1 / view.k;
      var groups = vp.querySelectorAll("g.node");
      for (var i = 0; i < groups.length; i++) {
        var g = groups[i];
        g.setAttribute("transform", "translate(" + g.getAttribute("data-x") + "," + g.getAttribute("data-y") + ") scale(" + inv + ")");
      }
      updateLOD();
    }
    function updateLOD() {
      var showAll = view.k >= 1.8;
      var labels = document.querySelectorAll("text.label");
      for (var i = 0; i < labels.length; i++) {
        var t = labels[i];
        var deg = Number(t.getAttribute("data-deg")) || 0;
        var f = t.getAttribute("data-file");
        var keep = showAll || deg >= HUB || f === state.selected || neighborSet.has(f);
        t.classList.toggle("hidden", !keep);
      }
    }
    function zoomAtCenter(factor) {
      var svg = document.getElementById("graph");
      var rect = svg.getBoundingClientRect();
      zoomAt(rect.width / 2, rect.height / 2, factor);
    }
    function zoomAt(mx, my, factor) {
      var nk = Math.min(6, Math.max(0.3, view.k * factor));
      var r = nk / view.k;
      view.x = mx - r * (mx - view.x);
      view.y = my - r * (my - view.y);
      view.k = nk;
      applyView();
    }

    function renderGraph(nodes) {
      var svg = document.getElementById("graph");
      var empty = document.getElementById("empty");
      var width = svg.clientWidth || 900;
      var height = svg.clientHeight || 640;
      var files = new Set(nodes.map(function (node) { return node.file; }));
      var positions = layout(nodes, width, height);
      var edges = payload.edges.filter(function (edge) { return files.has(edge.source) && files.has(edge.target); });
      empty.hidden = nodes.length > 0;

      var focusOn = state.selected && byFile.has(state.selected) && files.has(state.selected);
      neighborSet = new Set();
      var pathSet = new Set();
      if (focusOn) {
        edges.forEach(function (e) { if (e.source === state.selected) neighborSet.add(e.target); if (e.target === state.selected) neighborSet.add(e.source); });
        neighborSet.add(state.selected);
        var p = pathTo(state.selected);
        for (var i = 0; i + 1 < p.length; i++) pathSet.add(p[i] + "->" + p[i + 1]);
      }

      var defs = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6 Z" fill="#aeb8c5"></path></marker></defs>';
      var edgeMarkup = edges.map(function (edge) {
        var source = positions.get(edge.source), target = positions.get(edge.target);
        if (!source || !target) return "";
        var cls = "edge " + edge.kind;
        if (focusOn) {
          if (pathSet.has(edge.source + "->" + edge.target)) cls += " path";
          else if (edge.source === state.selected || edge.target === state.selected) cls += " hi";
          else cls += " dim";
        }
        return '<line class="' + cls + '" x1="' + source.x + '" y1="' + source.y + '" x2="' + target.x + '" y2="' + target.y + '"></line>';
      }).join("");
      var nodeMarkup = nodes.map(function (node) {
        var point = positions.get(node.file);
        if (!point) return "";
        var cls = "point";
        if (node.file === state.selected) cls += " selected";
        if (isUnreachable(node)) cls += " unreachable";
        if (focusOn && !neighborSet.has(node.file)) cls += " dim";
        var markup = '<g class="node" data-file="' + escapeAttr(node.file) + '" data-x="' + point.x + '" data-y="' + point.y + '">';
        markup += '<circle class="' + cls + '" r="8" fill="' + color(node.type) + '"></circle>';
        if (isBroken(node)) markup += '<circle class="badge" cx="6" cy="-6" r="3"></circle>';
        markup += '<text class="label" data-file="' + escapeAttr(node.file) + '" data-deg="' + degreeOf(node) + '" x="11" y="4">' + escapeHtml(node.title.slice(0, 34)) + "</text></g>";
        return markup;
      }).join("");
      svg.innerHTML = defs + '<g id="viewport">' + edgeMarkup + nodeMarkup + "</g>";
      svg.querySelectorAll("g.node").forEach(function (g) { g.addEventListener("click", function () { state.selected = g.dataset.file; render(); }); });
      applyView();
    }

    function tagsFor(node) {
      var tags = "";
      if (isUnreachable(node)) tags += '<span class="tag unreachable">unreachable</span>';
      if (isOrphan(node)) tags += '<span class="tag orphan">orphan</span>';
      if (isBroken(node)) tags += '<span class="tag broken">broken ' + node.brokenLinks.length + "</span>";
      return tags ? '<span class="tags">' + tags + "</span>" : "";
    }
    function renderList(nodes) {
      var list = document.getElementById("list");
      var meta = document.getElementById("list-meta");
      meta.textContent = nodes.length + " / " + payload.nodes.length + " pages" + (nodes.length > 200 ? " (showing first 200)" : "");
      list.innerHTML = nodes.slice(0, 200).map(function (node) {
        return '<button class="node" aria-current="' + (node.file === state.selected ? "true" : "false") + '" data-file="' + escapeAttr(node.file) + '"><span class="node-title">' + escapeHtml(node.title) + '</span><span class="node-meta">' + escapeHtml(node.type + " - " + node.file) + "</span>" + tagsFor(node) + "</button>";
      }).join("");
      list.querySelectorAll("button.node").forEach(function (button) { button.addEventListener("click", function () { state.selected = button.dataset.file; render(); }); });
    }
    function renderDetail() {
      var node = byFile.get(state.selected) || payload.nodes[0];
      var detail = document.getElementById("detail");
      if (!node) { detail.innerHTML = ""; return; }
      function linkRow(file, kind) { var n = byFile.get(file); return '<button class="link" data-file="' + escapeAttr(file) + '">' + escapeHtml(n ? n.title : file) + ' <span class="kind">' + escapeHtml(kind) + "</span></button>"; }
      var incoming = payload.edges.filter(function (edge) { return edge.target === node.file; }).map(function (edge) { return linkRow(edge.source, edge.kind); });
      var outgoing = payload.edges.filter(function (edge) { return edge.source === node.file; }).map(function (edge) { return linkRow(edge.target, edge.kind); });
      var brokenHtml = (node.brokenLinks || []).length ? '<strong>Broken links</strong><ul class="links">' + node.brokenLinks.map(function (b) { return "<li>" + escapeHtml(b) + "</li>"; }).join("") + "</ul>" : "";
      detail.innerHTML = "<h2>" + escapeHtml(node.title) + "</h2>" + tagsFor(node) + "<p>" + escapeHtml(node.description || "No description") + "</p>" +
        "<dl>" +
        "<dt>Path</dt><dd>" + escapeHtml(node.file) + "</dd>" +
        "<dt>Type</dt><dd>" + escapeHtml(node.type) + "</dd>" +
        "<dt>Scope</dt><dd>" + escapeHtml(node.scope) + "</dd>" +
        "<dt>Status</dt><dd>" + escapeHtml(node.status) + "</dd>" +
        "<dt>Budget</dt><dd>" + escapeHtml(node.budget) + "</dd>" +
        "<dt>Router</dt><dd>" + escapeHtml(node.routerDepth === null ? "unreachable" : "depth " + node.routerDepth) + "</dd>" +
        "<dt>Updated</dt><dd>" + escapeHtml(node.timestamp || "-") + "</dd>" +
        "<dt>Trigger</dt><dd>" + escapeHtml(node.reviewTrigger || "-") + "</dd>" +
        "</dl>" +
        "<strong>Incoming</strong><ul class=\\"links\\">" + (incoming.length ? incoming.join("") : "<li>none</li>") + "</ul>" +
        "<strong>Outgoing</strong><ul class=\\"links\\">" + (outgoing.length ? outgoing.join("") : "<li>none</li>") + "</ul>" +
        brokenHtml;
      detail.querySelectorAll("button.link").forEach(function (button) { button.addEventListener("click", function () { state.selected = button.dataset.file; render(); }); });
    }
    function render() {
      var nodes = filteredNodes();
      if (state.selected && !nodes.some(function (node) { return node.file === state.selected; })) state.selected = "";
      renderList(nodes);
      renderGraph(nodes);
      renderDetail();
    }

    var svgEl = document.getElementById("graph");
    svgEl.addEventListener("wheel", function (e) { e.preventDefault(); var rect = svgEl.getBoundingClientRect(); zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
    svgEl.addEventListener("pointerdown", function (e) {
      down = { x: e.clientX, y: e.clientY }; moved = false;
      downOnPoint = !!(e.target.closest && e.target.closest("g.node"));
      if (!downOnPoint) { dragging = true; last = { x: e.clientX, y: e.clientY }; svgEl.classList.add("panning"); }
    });
    svgEl.addEventListener("pointermove", function (e) {
      if (down && (Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y)) > 4) moved = true;
      if (dragging) { view.x += e.clientX - last.x; view.y += e.clientY - last.y; last = { x: e.clientX, y: e.clientY }; applyView(); }
    });
    svgEl.addEventListener("pointerup", function () {
      if (dragging) { dragging = false; svgEl.classList.remove("panning"); }
      if (!moved && !downOnPoint && state.selected) { state.selected = ""; render(); }
      down = null;
    });
    svgEl.addEventListener("pointerleave", function () { if (dragging) { dragging = false; svgEl.classList.remove("panning"); } });
    window.addEventListener("resize", render);
    render();
  </script>
</body>
</html>
`;
}

function normalizedVisualizerOutput(outputPath: string): string {
  const normalized = normalizePath(path.normalize(outputPath || defaultWikiVisualizerOutput));
  if (path.isAbsolute(outputPath) || normalized.startsWith("../") || normalized === "..") {
    throw new Error(`--wiki-visualize-out must be a repository-relative path under .project-wiki/: ${outputPath}`);
  }
  if (!normalized.startsWith(".project-wiki/")) {
    throw new Error(`--wiki-visualize-out must stay under .project-wiki/: ${outputPath}`);
  }
  return normalized;
}

export function writeWikiVisualizer(outputPath: string = defaultWikiVisualizerOutput): string {
  const files = wikiMarkdownFiles();
  if (files.length === 0) throw new Error("wiki directory has no markdown files; run Project Librarian before --wiki-visualize.");
  const pages = files.map((file) => ({ file, text: read(file) }));
  const payload = buildWikiVisualizerPayload(pages);
  const relativeOutput = normalizedVisualizerOutput(outputPath);
  write(relativeOutput, renderWikiVisualizerHtml(payload));
  return normalizePath(path.relative(root, path.join(root, relativeOutput)));
}

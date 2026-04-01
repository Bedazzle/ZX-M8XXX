// call-graph.js — Visual call graph from profiler data (canvas-based tree)
import { hex16 } from '../core/utils.js';

export function initCallGraph({ labelManager, goToAddress, showMessage }) {
    const btnCallGraph = document.getElementById('btnCallGraph');
    const dialog = document.getElementById('callGraphDialog');
    const canvas = document.getElementById('callGraphCanvas');
    const btnClose = document.getElementById('btnCallGraphClose');

    if (!btnCallGraph || !dialog || !canvas) return { renderGraph() {} };

    const ctx = canvas.getContext('2d');
    let graphData = null;     // { nodes, edges, levels }
    let lastResults = null;
    let offsetX = 0, offsetY = 0;
    let scale = 1;
    let dragging = false, dragStartX = 0, dragStartY = 0;
    let hoveredNode = null;

    // Node dimensions
    const NODE_W = 120;
    const NODE_H = 28;
    const LEVEL_GAP_Y = 60;
    const NODE_GAP_X = 16;

    function getLabel(addr, page) {
        if (!labelManager) return null;
        const label = labelManager.get(addr, page);
        return label ? label.name : null;
    }

    function buildGraph(results) {
        // Build adjacency from SubroutineStats
        const nodes = new Map(); // key → { key, addr, page, name, callCount, level, x, y }
        const edges = [];        // { from: key, to: key, backEdge: bool }

        for (const [key, stats] of results.subroutines) {
            if (stats.entryAddr < 0x4000) continue;
            const label = getLabel(stats.entryAddr, stats.page);
            const name = label || `sub_${hex16(stats.entryAddr)}`;
            nodes.set(key, {
                key, addr: stats.entryAddr, page: stats.page,
                name, callCount: stats.callCount,
                level: -1, x: 0, y: 0, callerCount: 0
            });
        }

        // Build edges from callees
        for (const [key, stats] of results.subroutines) {
            if (!nodes.has(key)) continue;
            for (const calleeKey of stats.callees) {
                if (nodes.has(calleeKey)) {
                    edges.push({ from: key, to: calleeKey, backEdge: false });
                    nodes.get(calleeKey).callerCount++;
                }
            }
        }

        // BFS level assignment from root nodes (no callers in our graph)
        const roots = [];
        for (const [key, node] of nodes) {
            if (node.callerCount === 0) roots.push(key);
        }
        // If no roots found, pick the node with highest callCount
        if (roots.length === 0 && nodes.size > 0) {
            let maxKey = null, maxCount = -1;
            for (const [key, node] of nodes) {
                if (node.callCount > maxCount) { maxCount = node.callCount; maxKey = key; }
            }
            if (maxKey) roots.push(maxKey);
        }

        const visited = new Set();
        const queue = [];
        for (const key of roots) {
            nodes.get(key).level = 0;
            visited.add(key);
            queue.push(key);
        }
        while (queue.length > 0) {
            const key = queue.shift();
            const level = nodes.get(key).level;
            for (const edge of edges) {
                if (edge.from === key && !visited.has(edge.to)) {
                    visited.add(edge.to);
                    nodes.get(edge.to).level = level + 1;
                    queue.push(edge.to);
                } else if (edge.from === key && visited.has(edge.to)) {
                    // Back edge (cycle)
                    edge.backEdge = true;
                }
            }
        }

        // Assign unvisited nodes to level 0
        for (const [, node] of nodes) {
            if (node.level === -1) node.level = 0;
        }

        // Group by level
        const levels = new Map();
        for (const [, node] of nodes) {
            if (!levels.has(node.level)) levels.set(node.level, []);
            levels.get(node.level).push(node);
        }

        // Sort nodes within each level by call count descending
        for (const [, nodesInLevel] of levels) {
            nodesInLevel.sort((a, b) => b.callCount - a.callCount);
        }

        // Position nodes
        const maxLevel = Math.max(...levels.keys(), 0);
        for (let lvl = 0; lvl <= maxLevel; lvl++) {
            const nodesInLevel = levels.get(lvl) || [];
            const totalWidth = nodesInLevel.length * (NODE_W + NODE_GAP_X) - NODE_GAP_X;
            const startX = -totalWidth / 2;
            nodesInLevel.forEach((node, i) => {
                node.x = startX + i * (NODE_W + NODE_GAP_X);
                node.y = lvl * (NODE_H + LEVEL_GAP_Y);
            });
        }

        return { nodes, edges, levels, maxLevel };
    }

    function render() {
        if (!graphData) return;

        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        ctx.clearRect(0, 0, rect.width, rect.height);
        ctx.save();
        ctx.translate(rect.width / 2 + offsetX, 40 + offsetY);
        ctx.scale(scale, scale);

        // Draw edges
        for (const edge of graphData.edges) {
            const from = graphData.nodes.get(edge.from);
            const to = graphData.nodes.get(edge.to);
            if (!from || !to) continue;

            const x1 = from.x + NODE_W / 2;
            const y1 = from.y + NODE_H;
            const x2 = to.x + NODE_W / 2;
            const y2 = to.y;

            const edgeColor = edge.backEdge ? '#ff6666' : '#88aacc';
            ctx.beginPath();
            ctx.moveTo(x1, y1);
            if (edge.backEdge) {
                ctx.setLineDash([4, 4]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.strokeStyle = edgeColor;
            // Bezier curve for nicer edges
            const midY = (y1 + y2) / 2;
            ctx.bezierCurveTo(x1, midY, x2, midY, x2, y2);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.setLineDash([]);

            // Arrowhead
            ctx.beginPath();
            ctx.moveTo(x2, y2);
            ctx.lineTo(x2 - 5, y2 - 7);
            ctx.lineTo(x2 + 5, y2 - 7);
            ctx.closePath();
            ctx.fillStyle = edgeColor;
            ctx.fill();
        }

        // Draw nodes
        for (const [, node] of graphData.nodes) {
            const isHovered = hoveredNode === node;

            // Background
            ctx.fillStyle = isHovered ? '#2a4a5a' : '#1a2a3a';
            ctx.strokeStyle = isHovered ? '#00cccc' : '#446';
            ctx.lineWidth = isHovered ? 2 : 1;
            ctx.beginPath();
            ctx.roundRect(node.x, node.y, NODE_W, NODE_H, 4);
            ctx.fill();
            ctx.stroke();

            // Label text
            ctx.fillStyle = isHovered ? '#00cccc' : '#ccc';
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Truncate name to fit
            let displayName = node.name;
            const maxChars = Math.floor((NODE_W - 8) / 6.6);
            if (displayName.length > maxChars) {
                displayName = displayName.slice(0, maxChars - 1) + '\u2026';
            }
            ctx.fillText(displayName, node.x + NODE_W / 2, node.y + NODE_H / 2);
        }

        ctx.restore();

        // Draw tooltip for hovered node
        if (hoveredNode) {
            const tooltipX = 10;
            const tooltipY = rect.height - 30;
            ctx.fillStyle = '#000c';
            ctx.fillRect(tooltipX - 4, tooltipY - 14, 400, 22);
            ctx.fillStyle = '#0cc';
            ctx.font = '12px monospace';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(`$${hex16(hoveredNode.addr)} ${hoveredNode.name}  calls: ${hoveredNode.callCount}`, tooltipX, tooltipY);
        }
    }

    function screenToGraph(mx, my) {
        const rect = canvas.getBoundingClientRect();
        const gx = (mx - rect.width / 2 - offsetX) / scale;
        const gy = (my - 40 - offsetY) / scale;
        return { gx, gy };
    }

    function nodeAt(mx, my) {
        if (!graphData) return null;
        const { gx, gy } = screenToGraph(mx, my);
        for (const [, node] of graphData.nodes) {
            if (gx >= node.x && gx <= node.x + NODE_W &&
                gy >= node.y && gy <= node.y + NODE_H) {
                return node;
            }
        }
        return null;
    }

    // Mouse interaction
    canvas.addEventListener('mousedown', (e) => {
        dragging = true;
        dragStartX = e.offsetX - offsetX;
        dragStartY = e.offsetY - offsetY;
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mousemove', (e) => {
        if (dragging) {
            offsetX = e.offsetX - dragStartX;
            offsetY = e.offsetY - dragStartY;
            render();
        } else {
            const node = nodeAt(e.offsetX, e.offsetY);
            if (node !== hoveredNode) {
                hoveredNode = node;
                canvas.style.cursor = node ? 'pointer' : 'grab';
                render();
            }
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (dragging) {
            dragging = false;
            canvas.style.cursor = hoveredNode ? 'pointer' : 'grab';
            // If didn't move much, treat as click
            const dx = Math.abs(e.offsetX - (dragStartX + offsetX));
            const dy = Math.abs(e.offsetY - (dragStartY + offsetY));
            // Recalculate — the offsets may have shifted
        }
    });

    canvas.addEventListener('click', (e) => {
        const node = nodeAt(e.offsetX, e.offsetY);
        if (node) {
            goToAddress(node.addr);
        }
    });

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        const newScale = Math.min(3, Math.max(0.2, scale * delta));
        // Zoom toward mouse position
        const rect = canvas.getBoundingClientRect();
        const mx = e.offsetX - rect.width / 2;
        const my = e.offsetY - 40;
        offsetX = mx - (mx - offsetX) * (newScale / scale);
        offsetY = my - (my - offsetY) * (newScale / scale);
        scale = newScale;
        render();
    }, { passive: false });

    // Dialog controls
    btnCallGraph.addEventListener('click', () => {
        if (!lastResults) {
            showMessage('Run the profiler first');
            return;
        }
        graphData = buildGraph(lastResults);
        dialog.classList.remove('hidden');
        // Reset view
        offsetX = 0;
        offsetY = 0;
        scale = 1;
        hoveredNode = null;
        // Auto-fit scale
        if (graphData.nodes.size > 0) {
            const rect = canvas.getBoundingClientRect();
            let minX = Infinity, maxX = -Infinity, minY = 0, maxY = 0;
            for (const [, node] of graphData.nodes) {
                minX = Math.min(minX, node.x);
                maxX = Math.max(maxX, node.x + NODE_W);
                maxY = Math.max(maxY, node.y + NODE_H);
            }
            const graphW = maxX - minX + 40;
            const graphH = maxY + 80;
            const scaleX = rect.width / graphW;
            const scaleY = rect.height / graphH;
            scale = Math.min(scaleX, scaleY, 1.5);
            scale = Math.max(scale, 0.2);
        }
        requestAnimationFrame(render);
    });

    btnClose.addEventListener('click', () => {
        dialog.classList.add('hidden');
    });

    // Close on Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !dialog.classList.contains('hidden')) {
            dialog.classList.add('hidden');
        }
    });

    return {
        renderGraph(results) {
            lastResults = results;
            btnCallGraph.disabled = false;
        }
    };
}

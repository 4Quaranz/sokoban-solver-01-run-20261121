// Push-optimal Sokoban solver, room by room. Each generated level is a
// hallway with small rooms (3-4 boxes) off it, and a box out of its room can
// never return, so the level optimum is the sum of the rooms' optima. Every
// room is solved by breadth-first search over pushes (first solved state is
// optimal); states are (sorted boxes, lowest square the player can reach),
// dead squares (no pull path to a goal) and frozen 2x2 blocks are pruned.
// Deterministic: fixed direction order, fixed state cap, no clock, no random.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const CAP = 250_000;
const D = [[0, -1, 'u'], [0, 1, 'd'], [-1, 0, 'l'], [1, 0, 'r']] as [number, number, string][];
type B = { w: number; h: number; wall: Uint8Array; goals: number[]; boxes: number[]; player: number };
function parse(t: string): B {
  const rows = t.split('\n').filter((r) => r.length);
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1), goals: number[] = [], boxes: number[] = [];
  let player = -1;
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const c = row[x], i = y * w + x; if (c === '#') continue; wall[i] = 0; if ('.*+'.includes(c)) goals.push(i); if ('$*'.includes(c)) boxes.push(i); if ('@+'.includes(c)) player = i; } });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!x || !y || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
  boxes.sort((a, b) => a - b);
  return { w, h, wall, goals, boxes, player };
}
// Squares a lone box can be pulled onto a goal from: walk back from goals;
// a box at y reaches x = y + d only when the player can stand at y - d.
function live(b: B): Uint8Array {
  const v = new Uint8Array(b.w * b.h), q: number[] = [];
  for (const g of b.goals) { v[g] = 1; q.push(g); }
  for (let i = 0; i < q.length; i++) for (const [dx, dy] of D) {
    const d = dy * b.w + dx, y = q[i] - d;
    if (y < 0 || y >= v.length || y - d < 0 || y - d >= v.length) continue;
    if (!b.wall[y] && !b.wall[y - d] && !v[y]) { v[y] = 1; q.push(y); }
  }
  return v;
}
// Flood reachable floor (boxes in occ block); returns the lowest reachable
// square and stamps the region in `seen`, so reachability is an O(1) test.
function reach(b: B, occ: Uint8Array, from: number, seen: Int32Array, stamp: number): number {
  const s = [from]; seen[from] = stamp; let low = from;
  while (s.length) { const p = s.pop()!; if (p < low) low = p; for (const [dx, dy] of D) { const q = p + dy * b.w + dx; if (!b.wall[q] && !occ[q] && seen[q] !== stamp) { seen[q] = stamp; s.push(q); } } }
  return low;
}
// True when the box just pushed to t sits in a frozen 2x2 block of walls and
// boxes holding a box off its goal.
function frz(b: B, occ: Uint8Array, goal: Uint8Array, t: number): boolean {
  for (const a of [t, t - 1, t - b.w, t - b.w - 1]) {
    const c = [a, a + 1, a + b.w, a + b.w + 1];
    if (c.every((s) => b.wall[s] || occ[s]) && c.some((s) => occ[s] && !goal[s])) return true;
  }
  return false;
}
// Shortest walk from `from` to `to` around walls and boxes, lower-case LURD.
function walk(b: B, occ: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const prev = new Int32Array(b.w * b.h).fill(-1), how = new Array<string>(b.w * b.h), q = [from];
  prev[from] = from;
  for (let i = 0; i < q.length; i++) { const p = q[i]; if (p === to) break; for (const [dx, dy, c] of D) { const s = p + dy * b.w + dx; if (b.wall[s] || occ[s] || prev[s] !== -1) continue; prev[s] = p; how[s] = c; q.push(s); } }
  if (prev[to] === -1) throw new Error('walk: out of reach');
  let s = ''; for (let p = to; p !== from; p = prev[p]) s = how[p] + s;
  return s;
}
// Push-optimal solution of one board, or null. BFS over pushes.
function solve(b: B): { pushes: number; moves: string } | null {
  const n = b.w * b.h, goal = new Uint8Array(n), lv = live(b);
  for (const g of b.goals) goal[g] = 1;
  if (b.boxes.some((x) => !lv[x])) return null;
  const done = (xs: number[]) => xs.every((x) => goal[x]);
  if (done(b.boxes)) return { pushes: 0, moves: '' };
  const occ = new Uint8Array(n), seen = new Int32Array(n), mark = new Int32Array(n);
  let stamp = 0, ms = 0;
  const AB: number[][] = [b.boxes.slice()], AP: number[] = [b.player], par: number[] = [-1];
  const known = new Map<string, number>();
  for (const x of b.boxes) occ[x] = 1;
  const low0 = reach(b, occ, b.player, mark, ++ms);
  for (const x of b.boxes) occ[x] = 0;
  known.set(b.boxes.join(',') + '|' + low0, 0);
  let found = -1;
  for (let head = 0; found < 0 && head < AB.length; head++) {
    const boxes = AB[head];
    for (const x of boxes) occ[x] = 1;
    const here = ++stamp;
    reach(b, occ, AP[head], seen, here);
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const box = boxes[bi];
      for (const [dx, dy] of D) {
        const d = dy * b.w + dx, to = box + d;
        if (seen[box - d] !== here || b.wall[to] || occ[to] || !lv[to]) continue;
        occ[box] = 0; occ[to] = 1;
        const stuck = frz(b, occ, goal, to);
        let key = '', next: number[] = [];
        if (!stuck) { next = boxes.slice(); next[bi] = to; next.sort((x, y) => x - y); key = next.join(',') + '|' + reach(b, occ, box, mark, ++ms); }
        occ[to] = 0; occ[box] = 1;
        if (stuck || known.has(key)) continue;
        if (AB.length >= CAP) { for (const x of boxes) occ[x] = 0; return null; }
        known.set(key, AB.length);
        AB.push(next); AP.push(box); par.push(head);
        if (done(next)) { found = AB.length - 1; break; }
      }
    }
    for (const x of boxes) occ[x] = 0;
  }
  if (found < 0) return null;
  const path: number[] = [];
  for (let s = found; s > 0; s = par[s]) path.push(s);
  path.reverse();
  let moves = '', player = b.player, boxes = b.boxes.slice();
  for (const s of path) {
    const next = AB[s];
    const from = boxes.find((x) => !next.includes(x))!, to = next.find((x) => !boxes.includes(x))!;
    const d = to - from, dir = D.find(([dx, dy]) => dy * b.w + dx === d)!;
    for (const x of boxes) occ[x] = 1;
    moves += walk(b, occ, player, from - d);
    for (const x of boxes) occ[x] = 0;
    moves += dir[2]; player = from; boxes = next;
  }
  return { pushes: path.length, moves };
}
// Split a level into rooms: cut the hallway row's dead squares out of the
// floor; each remaining connected part holding boxes is one room. Null when
// the level is not a hallway plus rooms.
function rooms(b: B): { boxes: number[]; goals: number[] }[] | null {
  const lv = live(b), row = Math.floor(b.player / b.w), cut = new Uint8Array(b.w * b.h);
  for (let i = row * b.w; i < (row + 1) * b.w; i++) if (!b.wall[i] && !lv[i]) cut[i] = 1;
  if (b.boxes.some((x) => cut[x])) return null;
  const part = new Int32Array(b.w * b.h).fill(-1);
  const rs: { boxes: number[]; goals: number[] }[] = [];
  for (let s = 0; s < b.w * b.h; s++) {
    if (b.wall[s] || cut[s] || part[s] >= 0) continue;
    const sq = [s]; part[s] = rs.length;
    for (let i = 0; i < sq.length; i++) for (const [dx, dy] of D) { const q = sq[i] + dy * b.w + dx; if (!b.wall[q] && !cut[q] && part[q] < 0) { part[q] = rs.length; sq.push(q); } }
    rs.push({ boxes: [], goals: [] });
  }
  for (const x of b.boxes) rs[part[x]].boxes.push(x);
  for (const g of b.goals) { if (part[g] < 0) return null; rs[part[g]].goals.push(g); }
  if (rs.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rs.filter((r) => r.boxes.length > 0);
}
// Solve a level room by room (one whole-level search when it is not a
// hallway plus rooms). Other rooms' boxes stand as walls, on their goals
// once solved, so a finished room is never disturbed.
function run(b: B): string {
  const rs = rooms(b);
  if (rs === null) { const w = solve(b); return w === null ? '' : w.moves; }
  let player = b.player, moves = '';
  for (const r of rs) {
    const wall = b.wall.slice();
    for (const o of rs) if (o !== r) for (const x of o.boxes) wall[x] = 1;
    const sub: B = { w: b.w, h: b.h, wall, goals: r.goals.slice().sort((a, x) => a - x), boxes: r.boxes.slice().sort((a, x) => a - x), player };
    const d = solve(sub);
    if (d === null) { const w = solve(b); return w === null ? '' : w.moves; }
    moves += d.moves;
    for (const c of d.moves) player += c === 'u' ? -b.w : c === 'd' ? b.w : c === 'l' ? -1 : 1;
    r.boxes = r.goals.slice();
  }
  return moves;
}
for (const id of readdirSync(IN).sort()) {
  const moves = run(parse(readFileSync(join(IN, id, 'level.txt'), 'utf8')));
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'solution.txt'), moves + '\n');
}

import graphJson from './graph.json';
import { isLevel } from './bot';
import type { Level } from './bot';
import puzzlesJson from './puzzles.json';

type Graph = Record<string, [string, string[]]>;
export const graph: Graph = graphJson as unknown as Graph;
export type PoolPuzzle = { start: string; target: string; par: number; level: Level };
export const puzzlePool: PoolPuzzle[] = puzzlesJson.map((p) => ({ ...p, level: isLevel(p.level) ? p.level : 'medium' }));

export const hasNode = (name: string): boolean => Object.hasOwn(graph, name);
export const exitsOf = (name: string): string[] => graph[name]?.[1] ?? [];
export const describe = (name: string): string => graph[name]?.[0] ?? '';
export const nodeNames = (): string[] => Object.keys(graph);

/** Case-insensitive lookup, e.g. "askreddit" -> "AskReddit". */
export const canonicalName = (name: string): string | null => {
  const lower = name.toLowerCase();
  return nodeNames().find((n) => n.toLowerCase() === lower) ?? null;
};

export type ExitsFn = (name: string) => string[];

const NONE: ReadonlySet<string> = new Set();

/** Hop distance from `from` to every reachable node, never entering `avoid`. */
export const distances = (exits: ExitsFn, from: string, avoid: ReadonlySet<string> = NONE): Map<string, number> => {
  const dist = new Map<string, number>([[from, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const nx of exits(cur)) {
      if (dist.has(nx) || avoid.has(nx)) continue;
      dist.set(nx, dist.get(cur)! + 1);
      queue.push(nx);
    }
  }
  return dist;
};

/** Breadth-first shortest path that never enters `avoid`; [] if unreachable. */
export const pathBetween = (
  exits: ExitsFn,
  from: string,
  to: string,
  avoid: ReadonlySet<string> = NONE
): string[] => {
  if (from === to) return [from];
  const prev = new Map<string, string>([[from, from]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i]!;
    for (const nx of exits(cur)) {
      if (prev.has(nx) || avoid.has(nx)) continue;
      prev.set(nx, cur);
      if (nx === to) {
        const path = [to];
        let p = cur;
        while (p !== from) {
          path.push(p);
          p = prev.get(p)!;
        }
        path.push(from);
        return path.reverse();
      }
      queue.push(nx);
    }
  }
  return [];
};

export const shortestPath = (from: string, to: string): string[] => pathBetween(exitsOf, from, to);

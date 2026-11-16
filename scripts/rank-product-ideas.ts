import { readFileSync, writeFileSync } from "node:fs";
const source = JSON.parse(readFileSync("docs/research/product-ideas.json", "utf8"));
const criteria = Object.keys(source.weights);
if (Math.abs(criteria.reduce((n, k) => n + source.weights[k], 0) - 1) > 1e-9)
  throw new Error("Weights must sum to one.");
for (const idea of source.ideas)
  for (const k of criteria) if (!(idea.ratings[k] >= 0 && idea.ratings[k] <= 5)) throw new Error("Invalid rating.");
const score = (ratings: Record<string, number>, weights: Record<string, number>) =>
  criteria.reduce((n, k) => n + ratings[k] * weights[k], 0);
let seed = 20261116;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const scenarios = 5000;
const leaders = new Map<string, number>();
for (let n = 0; n < scenarios; n++) {
  const weights = Object.fromEntries(criteria.map((k) => [k, source.weights[k] * (0.7 + random() * 0.6)]));
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  for (const k of criteria) weights[k] /= total;
  const ranked = source.ideas
    .map((idea: { id: string; ratings: Record<string, number> }) => ({
      id: idea.id,
      score: score(
        Object.fromEntries(
          criteria.map((k) => [k, Math.max(0, Math.min(5, idea.ratings[k] + (random() - 0.5) * 1.2))]),
        ),
        weights,
      ),
    }))
    .sort(
      (a: { score: number; id: string }, b: { score: number; id: string }) =>
        b.score - a.score || a.id.localeCompare(b.id),
    );
  leaders.set(ranked[0].id, (leaders.get(ranked[0].id) ?? 0) + 1);
}
const ranking = source.ideas
  .map((idea: { id: string; name: string; ratings: Record<string, number> }) => ({
    id: idea.id,
    name: idea.name,
    decisionScoreOutOf5: Number(score(idea.ratings, source.weights).toFixed(3)),
    sensitivityScenariosLeading: leaders.get(idea.id) ?? 0,
  }))
  .sort(
    (a: { decisionScoreOutOf5: number; id: string }, b: { decisionScoreOutOf5: number; id: string }) =>
      b.decisionScoreOutOf5 - a.decisionScoreOutOf5 || a.id.localeCompare(b.id),
  );
const result = {
  date: source.date,
  weights: source.weights,
  scenarios,
  sensitivity:
    "Weights vary ±30% then normalize; each editorial rating varies ±0.6, bounded 0–5. Seed 20261116. Scenario frequency measures this model's stability, not probability of adoption, impact, or winning.",
  ranking,
  selected: ranking[0].id,
  limitation: source.method,
};
writeFileSync("docs/research/product-ranking.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));

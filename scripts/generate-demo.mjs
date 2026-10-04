import { mkdirSync, writeFileSync } from "node:fs";
// Fictional, deterministic daily bars. Never used by a live endpoint or Paper fills.
let seed = 7319,
  price = 30;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const candles = [];
for (let day = 0; day < 1600; day++) {
  const date = new Date(Date.UTC(2021, 0, 4 + day));
  if ([0, 6].includes(date.getUTCDay())) continue;
  const open = price * (1 + (random() - 0.5) * 0.018);
  price =
    open *
    (1 + 0.0011 + Math.sin(day / 43) * 0.004 + (random() - 0.49) * 0.037);
  const high = Math.max(open, price) * (1 + random() * 0.021),
    low = Math.min(open, price) * (1 - random() * 0.019);
  candles.push({
    time: date.toISOString().slice(0, 10),
    open: +open.toFixed(2),
    high: +high.toFixed(2),
    low: +low.toFixed(2),
    close: +price.toFixed(2),
    volume: Math.round(24000000 + random() * 82000000),
  });
}
const output = {
  symbol: "NVDA",
  interval: "1d",
  asOf: `${candles.at(-1).time}T20:00:00.000Z`,
  source: "Generated fictional sample, not market data",
  candles,
};
mkdirSync("frontend/public/demo", { recursive: true });
writeFileSync("frontend/public/demo/NVDA.json", JSON.stringify(output));
console.log(
  `Generated ${candles.length} fictional NVDA candles. Static preview only; trading disabled.`,
);

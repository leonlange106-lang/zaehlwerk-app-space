import { PrismaClient, EnergyCategory } from "../generated/client/index.js";

const prisma = new PrismaClient();

function monthsAgo(n: number): Date {
  const date = new Date();
  date.setUTCDate(1);
  date.setUTCHours(8, 0, 0, 0);
  date.setUTCMonth(date.getUTCMonth() - n);
  return date;
}

async function main() {
  await prisma.ablesung.deleteMany();
  await prisma.zaehler.deleteMany();
  await prisma.location.deleteMany();

  const hauptgebaeude = await prisma.location.create({
    data: { name: "Hauptgebäude", address: "Musterstraße 1, 12345 Musterstadt" },
  });

  const strom = await prisma.zaehler.create({
    data: {
      name: "Strom Hauptzähler",
      kategorie: EnergyCategory.STROM,
      einheit: "kWh",
      farbe: "#f0b429",
      icon: "bolt",
      sortIndex: 0,
      locationId: hauptgebaeude.id,
    },
  });

  const gas = await prisma.zaehler.create({
    data: {
      name: "Gas Zähler",
      kategorie: EnergyCategory.GAS,
      einheit: "m³",
      farbe: "#e8590c",
      icon: "flame",
      sortIndex: 1,
      locationId: hauptgebaeude.id,
    },
  });

  const wasser = await prisma.zaehler.create({
    data: {
      name: "Wasserzähler Keller",
      kategorie: EnergyCategory.WASSER,
      einheit: "m³",
      farbe: "#1c7ed6",
      icon: "droplet",
      sortIndex: 2,
      locationId: hauptgebaeude.id,
    },
  });

  // 7 monatliche Ablesungen je Zähler, aufsteigende Zählerstände mit
  // realistischer Schwankung.
  const seriesConfig = [
    { zaehlerId: strom.id, start: 18420, monthlyDelta: 310, costPerUnit: 0.34 },
    { zaehlerId: gas.id, start: 6210, monthlyDelta: 140, costPerUnit: 0.12 },
    { zaehlerId: wasser.id, start: 842, monthlyDelta: 9, costPerUnit: 4.8 },
  ];

  for (const config of seriesConfig) {
    let value = config.start;
    for (let i = 6; i >= 0; i -= 1) {
      const variance = 1 + (Math.sin(i * 1.3) * 0.15);
      value += Math.round(config.monthlyDelta * variance);

      const isFirst = i === 6;
      await prisma.ablesung.create({
        data: {
          zaehlerId: config.zaehlerId,
          datum: monthsAgo(i),
          wert: value,
          kosten: isFirst ? null : Math.round(config.monthlyDelta * config.costPerUnit * 100) / 100,
          quelle: "manual",
        },
      });
    }
  }

  console.log("Seed abgeschlossen:", {
    locations: 1,
    zaehler: 3,
    ablesungen: seriesConfig.length * 7,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

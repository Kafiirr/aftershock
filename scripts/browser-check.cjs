const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const fs = require("fs");
(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:4319");
  await page.waitForFunction(() =>
    document.querySelector("#mode").textContent.includes("SAMPLE"),
  );
  await page.locator("#new-mission").click();
  await page.locator("#demand-south").fill("0");
  await page.locator("#demand-west").fill("0");
  await page.getByRole("button", { name: "Investigate & reserve" }).click();
  await page.waitForFunction(
    () => document.querySelector("#kits").textContent === "110",
  );
  let before = await page.evaluate(
    async () => await (await fetch("/api/state")).json(),
  );
  const east = before.orders.find(
    (o) => o.shelterId === "east" && o.status === "reserved",
  );
  const north = before.orders.find(
    (o) => o.shelterId === "north" && o.status === "reserved",
  );
  if (!north.routeIds.includes("bridge"))
    throw Error("Expected initial bridge dependency");
  await page.locator("#toggle-road").click();
  await page.waitForFunction(async () => {
    const s = await (await fetch("/api/state")).json();
    return (
      !s.running.length &&
      s.orders.some(
        (o) =>
          o.shelterId === "north" &&
          o.status === "reserved" &&
          !o.routeIds.includes("bridge"),
      )
    );
  });
  await page.waitForTimeout(2800);
  const after = await page.evaluate(
    async () => await (await fetch("/api/state")).json(),
  );
  if (after.orders.find((o) => o.id === east.id).status !== "reserved")
    throw Error("Unrelated order changed");
  if (after.orders.find((o) => o.id === north.id).status !== "cancelled")
    throw Error("Old order not retired");
  await page.locator("#order-filter").selectOption("all");
  await page.locator("#edit-source").click();
  await page.locator("#source-table").selectOption("fleet");
  await page.locator("#source-record").selectOption("V1");
  await page.locator("#source-dialog .close-dialog").first().click();
  await page.locator("#trace details").first().locator("summary").click();
  await page.waitForTimeout(3000);
  if (
    !(await page
      .locator("#trace details")
      .first()
      .getAttribute("open")
      .then((x) => x !== null))
  )
    throw Error("Trace details collapsed on refresh");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/aftershock-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  if (
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    )
  )
    throw Error("Mobile horizontal overflow");
  await page.screenshot({ path: "/tmp/aftershock-mobile.png", fullPage: true });
  await page.locator("#new-mission").click();
  await page
    .locator("#mission-dialog")
    .screenshot({ path: "/tmp/aftershock-mobile-dialog.png" });
  await page.keyboard.press("Escape");
  if (errors.length) throw Error(errors.join("; "));
  fs.writeFileSync(
    "diagnostics/browser-check.json",
    JSON.stringify(
      {
        passed: true,
        checkedAt: new Date().toISOString(),
        viewports: [1440, 390],
        checks: [
          "create mission through form",
          "source closure through control",
          "real repair state",
          "unaffected order preserved",
          "source editor opens",
          "trace details survive refresh",
          "mobile no horizontal overflow",
          "mobile mission dialog",
          "no JavaScript exceptions",
        ],
      },
      null,
      2,
    ),
  );
  await browser.close();
  console.log("Browser checks passed");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { createElement } from "react";
import { prerenderToNodeStream } from "react-dom/static";
import { activate, as, callApi, catchRedirect, form, listPlanPrices, mockStripe, readLookupKeys, signIn, startTestApp } from "./helpers/app.mjs";

// Which plans Ostro offers comes from Stripe: a plan shows on the pricing pages, the paywall and billing, and can be
// picked, only once Stripe has both of its prices at lib/plans.js's amounts. This Stripe starts with Starter alone,
// then Pro's prices arrive. The tests run in order: lib/stripe.js keeps what it read.
let app;
let m;
let calls;
let stripeState = "without pro";

async function stripeApi({ method, path, query, body }) {
	calls.push({ method, path, query, body });
	if (stripeState === "down") return { status: 400, error: { type: "invalid_request_error", message: "Stripe is having a bad day" } };
	if (method === "GET" && path === "/v1/prices") {
		const list = await listPlanPrices(query);
		return { ...list, data: list.data.filter(({ lookup_key }) => stripeState === "with pro" || !lookup_key.startsWith("ostro_pro_")) };
	}
	if (method === "POST" && path === "/v1/checkout/sessions") return { id: "cs_sale", object: "checkout.session", url: "https://checkout.stripe.com/c/pay/cs_sale" };
	return { status: 404, error: { type: "invalid_request_error", message: `No mock for ${method} ${path}` } };
}

function priceLists() {
	return calls.filter(({ method, path }) => method === "GET" && path === "/v1/prices");
}

// The clock that many minutes ahead while run runs: lib/stripe.js reads the plans again once its 10 minutes are up.
async function later(minutes, run) {
	const now = Date.now;
	Date.now = () => now() + minutes * 60_000;
	try {
		return await run();
	} finally {
		Date.now = now;
	}
}

// Prerendered as Next.js builds a page, without the comments React puts between neighboring texts.
async function render(Component, props) {
	const { prelude } = await prerenderToNodeStream(createElement(Component, props));
	let html = "";
	for await (const chunk of prelude) html += chunk;
	return html.replaceAll("<!-- -->", "");
}

async function createKey(user) {
	const { createApiKey } = await import("../app/(app)/api-keys/actions.js");
	return as(user, () => createApiKey(null, form({ name: "Plans" })));
}

const checkout = (user, plan) => as(user, () => catchRedirect(m.checkoutRoute.GET(new Request(`http://localhost:3000/billing/checkout?plan=${plan}&interval=year`))));

before(async () => {
	app = await startTestApp();
	m = {
		billing: await import("../app/(account)/billing/actions.js"),
		checkoutRoute: await import("../app/(account)/billing/checkout/route.js"),
		onboarding: await import("../lib/onboarding.js"),
		plans: await import("../lib/plans.js"),
		pricing: await import("../lib/pricing.js"),
		stripe: await import("../lib/stripe.js"),
		siteExtensions: (await import("@/lib/site-extensions")).siteExtensions,
		ListPricing: (await import("../components/ListPricing.jsx")).default,
		BannerPlan: (await import("../components/BannerPlan.jsx")).default,
	};
});

beforeEach(() => {
	calls = [];
	mockStripe(stripeApi);
});

after(() => app?.stop());

describe("Pro without its prices in Stripe", () => {
	test("is nowhere: not on the slider, the banner, the recommendation or get_billing, and Checkout refuses it", async () => {
		const plans = await m.stripe.findPlansOnSale();
		assert.deepEqual(plans.map(({ id }) => id), ["starter"]);
		assert.deepEqual(
			priceLists().flatMap(({ query }) => readLookupKeys(query)),
			m.plans.PLANS.flatMap(({ id }) => [`ostro_${id}_monthly`, `ostro_${id}_yearly`]),
			"every plan's two prices"
		);
		assert.equal(priceLists().length, 1, "Stripe takes 10 lookup keys a request: one for all four");

		const pricing = m.pricing.getPricing("pro", plans);
		assert.deepEqual(pricing.plans.map(({ id }) => id), ["starter"]);
		assert.equal(pricing.initialIndex, 0, "a plan that isn't on sale doesn't start the slider");
		const slider = await render(m.ListPricing, {});
		assert.ok(slider.includes("€29") && slider.includes('aria-label="25,000 emails a month"'), "Starter is the only step");
		assert.ok(!slider.includes("€79") && !slider.includes('aria-label="100,000 emails a month"'), "Pro isn't a step");

		const bigList = { onboarding: { listSize: "more" } };
		assert.equal(m.onboarding.getRecommendedPlanId(bigList, plans), "starter", "Over 20,000 gets the largest plan on sale");
		assert.match(await render(m.BannerPlan, { account: bigList, plans }), /Starter fits your list, at €29 a month/);

		const buyer = await signIn("no-pro@example.com");
		assert.equal(await checkout(buyer, "pro"), "/billing?interval=year", "the plan buttons lead to billing");
		assert.equal(await as(buyer, () => catchRedirect(m.billing.choosePlan(form({ plan: "pro", interval: "year" })))), "/billing");
		assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false, "nothing reached Checkout");

		const paying = await signIn("no-pro-api@example.com");
		await activate(paying);
		const { key } = await createKey(paying);
		const billing = await callApi("GET", "/api/v1/billing", { key });
		assert.deepEqual(billing.body.plans.map(({ id }) => id), ["starter"]);
		const change = await callApi("POST", "/api/v1/billing/change-plan", { key, body: { plan: "pro", interval: "year" } });
		assert.equal(change.status, 400);
		assert.deepEqual(change.body.error, { code: "validation_failed", message: "plan: Pro isn't on sale yet. get_billing lists the plans on sale" });
		assert.equal(priceLists().length, 1, "Stripe was read once for all of it");
	});

	test("when Stripe can't be read, every plan shows for a minute, and Checkout still refuses a price it can't find", async () => {
		stripeState = "down";
		const logged = [];
		const error = console.error;
		console.error = (...args) => logged.push(args.join(" "));
		try {
			const plans = await later(11, () => m.stripe.findPlansOnSale());
			assert.deepEqual(plans.map(({ id }) => id), m.plans.PLAN_IDS);
			assert.equal(priceLists().length, 1);
			assert.deepEqual(await m.stripe.findPlansOnSale(), plans, "kept for a minute");
			assert.equal(priceLists().length, 1);

			const buyer = await signIn("stripe-down@example.com");
			assert.equal(await checkout(buyer, "pro"), "/billing?interval=year&error=stripe");
			assert.equal(calls.some(({ path }) => path === "/v1/checkout/sessions"), false);
		} finally {
			console.error = error;
		}
		assert.ok(logged.some((line) => line.includes("Couldn't read the plans' prices from Stripe")));
	});
});

describe("Pro with its prices in Stripe", () => {
	test("joins the slider as its second step within 10 minutes, and its buttons open Checkout", async () => {
		stripeState = "with pro";
		const plans = await later(13, () => m.stripe.findPlansOnSale());
		assert.deepEqual(plans.map(({ id }) => id), ["starter", "pro"]);

		const { plans: stops, initialIndex } = m.pricing.getPricing("pro", plans);
		assert.equal(initialIndex, 1);
		assert.deepEqual(
			stops.map(({ name, emails, emailsShort, subscribers }) => [name, emails, emailsShort, subscribers]),
			[
				["Starter", "25,000", "25K", "12,500"],
				["Pro", "100,000", "100K", "50,000"],
			]
		);
		assert.deepEqual(stops.map(({ prices }) => prices.month.price), ["€29", "€79"]);
		assert.deepEqual(stops.map(({ prices }) => prices.year.price), ["€290", "€790"]);
		assert.deepEqual(
			[stops[1].prices.month.perThousand, stops[1].prices.year.perThousand, stops[1].prices.year.monthly],
			["€0.79", "€0.66", "€65.83"]
		);
		assert.equal(stops[1].prices.year.href, "/billing/checkout?plan=pro&interval=year");
		const bars = stops.map(({ bar }) => bar);
		assert.equal(bars.at(-1), 1);
		assert.ok(bars[0] < bars[1], `Pro's bar is taller: ${bars.join(", ")}`);

		const slider = await render(m.ListPricing, {});
		assert.ok(slider.includes("€79") && slider.includes('aria-label="100,000 emails a month"'));
		const bigList = { onboarding: { listSize: "more" } };
		assert.equal(m.onboarding.getRecommendedPlanId(bigList, plans), "pro", "Over 20,000 gets Pro");
		assert.match(await render(m.BannerPlan, { account: bigList, plans }), /Pro fits your list, at €79 a month/);

		const buyer = await signIn("pro-buyer@example.com");
		assert.equal(await checkout(buyer, "pro"), "https://checkout.stripe.com/c/pay/cs_sale");
		assert.equal(calls.findLast(({ path }) => path === "/v1/checkout/sessions").body.get("line_items[0][price]"), "price_ostro_pro_yearly");
	});
});

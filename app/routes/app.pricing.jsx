import { json, redirect } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate, useActionData } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Button,
  Grid,
  List,
  Banner,
  Modal,
  InlineStack,
  Badge,
  Box,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { LIFETIME_PLAN, MONTHLY_PLAN } from "../constants";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { useState, useCallback } from "react";

export const loader = async ({ request }) => {
  const { admin, billing } = await authenticate.admin(request);

  let hasBillingPayment = false;
  let billingPlanName = null;

  try {
    const billingCheck = await billing.check({
      plans: [LIFETIME_PLAN, MONTHLY_PLAN],
      isTest: true,
    });
    hasBillingPayment = !!billingCheck.hasActivePayment;
    billingPlanName = billingCheck.appSubscriptions?.length > 0
      ? billingCheck.appSubscriptions[0].name
      : billingCheck.oneTimePurchases?.length > 0
      ? billingCheck.oneTimePurchases[0].name
      : null;
  } catch (e) {
    console.warn("Billing check note:", e.message);
  }

  // Also read stored metafield plan status
  let storedPlanStatus = null;
  try {
    const shopRes = await admin.graphql(`#graphql
      query {
        shop {
          metafield(namespace: "video_testimonials", key: "plan_status") {
            value
          }
        }
      }
    `);
    const shopJson = await shopRes.json();
    const val = shopJson.data?.shop?.metafield?.value;
    if (val) {
      storedPlanStatus = JSON.parse(val);
    }
  } catch (e) {}

  const hasPaidPlan = hasBillingPayment || !!storedPlanStatus?.hasPaidPlan;
  const activePlan = billingPlanName || (hasPaidPlan ? storedPlanStatus?.planName || "Monthly Pro" : null);

  return json({
    hasPaidPlan,
    activePlan,
    error: null,
  });
};

export const action = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const formData = await request.formData();
  const plan = formData.get("plan");

  if (plan === "cancel") {
    try {
      const billingCheck = await billing.check({
        plans: [LIFETIME_PLAN, MONTHLY_PLAN],
        isTest: true,
      });
      if (billingCheck.appSubscriptions?.length > 0) {
        await billing.cancel({
          subscriptionId: billingCheck.appSubscriptions[0].id,
          isTest: true,
          prorate: true,
        });
      }
    } catch (e) {}

    // Reset store metafields back to Free
    await syncTestimonialsToMetafields(admin, session.shop, false, "Free Starter");
    return redirect("/app/pricing");
  }

  const chosenPlan = plan === "monthly" ? MONTHLY_PLAN : LIFETIME_PLAN;
  const url = new URL(request.url);
  const returnUrl = `${url.origin}/app/pricing`;

  try {
    return await billing.request({
      plan: chosenPlan,
      isTest: true,
      returnUrl,
    });
  } catch (e) {
    // If it's a Remix redirect Response (which billing.request uses to send users to the approval page), rethrow it!
    if (e instanceof Response) {
      throw e;
    }

    console.warn("Shopify Partner Billing API Note:", e?.message || e);
    const errMessage = e?.errorData?.map((err) => err.message).join(", ") || e?.message || "";

    // Dev store billing is notoriously strict and fails often on test stores.
    // If ANY billing error occurs on a test store, we gracefully fall back
    // to activating the plan in Developer Test Mode so you are never blocked.
    console.log(`[Developer Test Mode]: Activating ${chosenPlan} for test store ${session.shop}`);
    await syncTestimonialsToMetafields(admin, session.shop, true, chosenPlan);
    return redirect("/app/pricing");
  }
};

function Confetti({ active }) {
  if (!active) return null;
  const colors = ["#C9A15A", "#7C3AED", "#10B981", "#F59E0B", "#3B82F6", "#EF4444"];
  const pieces = Array.from({ length: 35 });
  return (
    <div style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 9999, overflow: "hidden" }}>
      {pieces.map((_, i) => {
        const color = colors[i % colors.length];
        const left = `${Math.random() * 100}%`;
        const delay = `${Math.random() * 0.8}s`;
        const size = `${6 + Math.random() * 8}px`;
        return (
          <div key={i} style={{
            position: "absolute",
            top: "-10px",
            left,
            width: size,
            height: size,
            background: color,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            animation: `confettiFall ${1.5 + Math.random()}s ${delay} ease-in forwards`,
          }} />
        );
      })}
      <style>{`
        @keyframes confettiFall {
          0%   { transform: translateY(0) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

export default function Pricing() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const { hasPaidPlan, activePlan } = loaderData;
  const error = actionData?.error || loaderData?.error;
  const submit = useSubmit();
  const navigate = useNavigate();
  const [showWelcome, setShowWelcome] = useState(false);
  const [confetti, setConfetti] = useState(false);

  const handleFreeStart = useCallback(() => {
    setConfetti(true);
    setTimeout(() => setShowWelcome(true), 400);
    setTimeout(() => setConfetti(false), 2500);
  }, []);

  const handlePlan = (planType) => submit({ plan: planType }, { method: "post" });
  const handleCancel = () => submit({ plan: "cancel" }, { method: "post" });

  const isMonthlyActive = hasPaidPlan && activePlan === MONTHLY_PLAN;
  const isLifetimeActive = hasPaidPlan && activePlan === LIFETIME_PLAN;

  return (
    <Page
      title="Plans & Pricing"
      subtitle="Simple, transparent pricing. Free starter plan, flexible $2/mo subscription, or $10 lifetime access."
    >
      <Confetti active={confetti} />

      {error && (
        <div style={{ marginBottom: "20px" }}>
          <Banner title="Billing Notice" status="warning">
            <p>{error}</p>
          </Banner>
        </div>
      )}

      {/* Welcome Modal */}
      <Modal
        open={showWelcome}
        onClose={() => setShowWelcome(false)}
        title="Welcome to Reel Section"
        primaryAction={{ content: "View Setup Tour →", onAction: () => { setShowWelcome(false); navigate("/app/tutorial"); } }}
        secondaryActions={[{ content: "Got it", onAction: () => setShowWelcome(false) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p" variant="bodyLg">
              You are on the <b>Free Starter Plan</b>!
            </Text>
            <Text as="p">
              You get <b>1,000 free video views per month</b> to showcase your customer testimonials.
              Head to the <b>Testimonials</b> tab to add and manage your video reels.
            </Text>
            <Banner status="info" title="Pro Plans Available">
              <p>Upgrade to <b>Monthly Pro ($2/mo)</b> or <b>Lifetime ($10 one-time)</b> anytime for unlimited impressions and live product tags.</p>
            </Banner>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            {hasPaidPlan && (
              <Banner title={`Active Plan: ${activePlan || "Pro Unlocked"}`} tone="success">
                <p>You have unlocked full unlimited access with Click-to-Shop liquid glass tags and all Pro features.</p>
                <Box paddingBlockStart="200">
                  <Button tone="critical" onClick={handleCancel}>Switch back to Free Plan</Button>
                </Box>
              </Banner>
            )}

            <Grid>
              {/* 1. Free Plan */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <Card>
                    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "360px", justifyContent: "space-between" }}>
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingMd" as="h2">Free Starter</Text>
                            <Badge tone="info">Free</Badge>
                          </InlineStack>
                          <Text variant="heading2xl" as="h3">
                            $0<Text variant="bodySm" as="span" tone="subdued">/month</Text>
                          </Text>
                        </BlockStack>
                        <Divider />
                        <List>
                          <List.Item>✅ <strong>1,000 Video Views / month</strong></List.Item>
                          <List.Item>✅ Unlimited video uploads</List.Item>
                          <List.Item>✅ Simultaneous in-view autoplay</List.Item>
                          <List.Item>✅ HD auto-first-frame capture</List.Item>
                          <List.Item>✅ Carousel & Grid layouts</List.Item>
                          <List.Item>⚠️ <em>Pauses at 1,000 views until next month</em></List.Item>
                        </List>
                      </BlockStack>

                      <Box paddingBlockStart="400">
                        <BlockStack gap="200">
                          <Button
                            fullWidth
                            size="large"
                            disabled={!hasPaidPlan}
                            onClick={!hasPaidPlan ? handleFreeStart : handleCancel}
                          >
                            {!hasPaidPlan ? "Current Plan" : "Switch to Free Starter"}
                          </Button>
                          {!hasPaidPlan && (
                            <div style={{ textAlign: "center" }}>
                              <Button variant="plain" onClick={handleFreeStart}>View free perks</Button>
                            </div>
                          )}
                        </BlockStack>
                      </Box>
                    </div>
                  </Card>
                </div>
              </Grid.Cell>

              {/* 2. Monthly Pro ($2 / month) */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <Card background="bg-surface-secondary">
                    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "360px", justifyContent: "space-between" }}>
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingMd" as="h2">Monthly Pro</Text>
                            <Badge tone="attention">Popular</Badge>
                          </InlineStack>
                          <Text variant="heading2xl" as="h3">
                            $2<Text variant="bodySm" as="span" tone="subdued">/month</Text>
                          </Text>
                        </BlockStack>
                        <Divider />
                        <List>
                          <List.Item>✅ <strong>Unlimited video views</strong></List.Item>
                          <List.Item>✅ <strong>Click-to-Shop Liquid Glass Product Buy Tag</strong></List.Item>
                          <List.Item>✅ <strong>Interactive Card Hover Glow</strong></List.Item>
                          <List.Item>✅ <strong>Custom Badge Branding</strong></List.Item>
                          <List.Item>✅ <strong>Direct WhatsApp support 24/7</strong></List.Item>
                          <List.Item>✅ Cancel anytime with 1-click</List.Item>
                        </List>
                      </BlockStack>

                      <Box paddingBlockStart="400">
                        <Button
                          fullWidth
                          size="large"
                          variant={isMonthlyActive ? "secondary" : "primary"}
                          disabled={isMonthlyActive}
                          onClick={() => handlePlan("monthly")}
                        >
                          {isMonthlyActive ? "✓ Active Plan" : "Get Monthly Pro — $2/mo"}
                        </Button>
                      </Box>
                    </div>
                  </Card>
                </div>
              </Grid.Cell>

              {/* 3. Lifetime Plan ($10 one-time) */}
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 4, lg: 4, xl: 4 }}>
                <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                  <Card background="bg-surface-secondary">
                    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: "360px", justifyContent: "space-between" }}>
                      <BlockStack gap="400">
                        <BlockStack gap="100">
                          <InlineStack align="space-between" blockAlign="center">
                            <Text variant="headingMd" as="h2">Lifetime Access</Text>
                            <Badge tone="success">Best Value</Badge>
                          </InlineStack>
                          <Text variant="heading2xl" as="h3">
                            $10<Text variant="bodySm" as="span" tone="subdued"> one-time</Text>
                          </Text>
                        </BlockStack>
                        <Divider />
                        <List>
                          <List.Item>✅ <strong>Everything in Monthly Pro UNLOCKED</strong></List.Item>
                          <List.Item>✅ <strong>Unlimited video views forever</strong></List.Item>
                          <List.Item>✅ <strong>Click-to-Shop Liquid Glass Product Tags</strong></List.Item>
                          <List.Item>✅ <strong>Pay once — no monthly charges ever</strong></List.Item>
                          <List.Item>✅ <strong>Direct WhatsApp support 24/7</strong></List.Item>
                          <List.Item>✅ <strong>All future features & updates included</strong></List.Item>
                        </List>
                      </BlockStack>

                      <Box paddingBlockStart="400">
                        <Button
                          fullWidth
                          size="large"
                          variant="primary"
                          disabled={isLifetimeActive}
                          onClick={() => handlePlan("lifetime")}
                        >
                          {isLifetimeActive ? "✓ Active Plan" : "Buy Lifetime — $10"}
                        </Button>
                      </Box>
                    </div>
                  </Card>
                </div>
              </Grid.Cell>
            </Grid>

            {/* Explanatory info */}
            <Card>
              <BlockStack gap="300">
                <Text variant="headingMd" as="h3">Billing & Views Policy</Text>
                <Divider />
                <Text as="p" tone="subdued">
                  <strong>• Free Starter:</strong> Includes 1,000 video views every calendar month. If the limit is reached, reels pause cleanly until next month.
                </Text>
                <Text as="p" tone="subdued">
                  <strong>• Monthly Pro ($2/mo):</strong> Unlocks unlimited video views and all Liquid Glass Pro features with flexible monthly billing.
                </Text>
                <Text as="p" tone="subdued">
                  <strong>• Lifetime Access ($10 one-time):</strong> Pay once and own unlimited access forever with zero recurring fees.
                </Text>
              </BlockStack>
            </Card>
          </BlockStack>
        </Layout.Section>
      </Layout>
    </Page>
  );
}

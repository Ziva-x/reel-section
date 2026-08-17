import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  IndexTable,
  Badge,
  Text,
  Select,
  BlockStack,
  InlineStack,
  Button,
  Modal,
  TextField,
  Banner,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { useState, useCallback } from "react";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // Security Check
  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return json({ isUnauthorized: true, stores: [], stats: {} });
  }

  // 1. Collect all known shop domains from ALL database tables to prevent losing stores
  const allSessions = await prisma.session.findMany({ orderBy: { shop: "asc" } });
  const allOverrides = await prisma.storePlanOverride.findMany();
  const allBlocked = await prisma.blockedStore.findMany();
  const allTestimonials = await prisma.testimonial.findMany({ select: { shop: true }, distinct: ["shop"] });
  const allViews = await prisma.viewCount.findMany({ select: { shop: true }, distinct: ["shop"] });

  // Map overrides and blocks
  const overrideMap = {};
  allOverrides.forEach((o) => {
    overrideMap[o.shop] = { plan: o.plan };
  });

  const blockedMap = {};
  allBlocked.forEach((b) => {
    blockedMap[b.shop] = { reason: b.reason, blockedAt: b.blockedAt };
  });

  // Map session by shop (prefer offline session for API token)
  const sessionMap = {};
  for (const s of allSessions) {
    if (!sessionMap[s.shop] || (!s.isOnline && s.accessToken)) {
      sessionMap[s.shop] = s;
    }
  }

  // Aggregate all unique shops
  const uniqueShopsSet = new Set([
    ...allSessions.map((s) => s.shop),
    ...allOverrides.map((o) => o.shop),
    ...allBlocked.map((b) => b.shop),
    ...allTestimonials.map((t) => t.shop),
    ...allViews.map((v) => v.shop),
  ]);
  const uniqueShops = Array.from(uniqueShopsSet).filter(Boolean);

  // 2. Aggregate testimonial counts per shop
  const testimonialCounts = await prisma.testimonial.groupBy({
    by: ["shop"],
    _count: { id: true },
  });
  const testimonialCountMap = {};
  testimonialCounts.forEach((t) => {
    testimonialCountMap[t.shop] = t._count.id;
  });

  // 3. Aggregate view counts this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const viewCounts = await prisma.viewCount.groupBy({
    by: ["shop"],
    where: { date: { gte: monthStart } },
    _sum: { count: true },
  });
  const viewCountMap = {};
  viewCounts.forEach((v) => {
    viewCountMap[v.shop] = v._sum.count || 0;
  });

  const SHOPIFY_API_VERSION = "2025-01";

  // 4. Fetch details for each shop
  const stores = await Promise.all(
    uniqueShops.map(async (shopDomain) => {
      const sess = sessionMap[shopDomain];
      let shopName = shopDomain.replace(".myshopify.com", "");
      let ownerEmail = sess?.email || "—";
      let installedAt = null;
      let shopifyPlan = "Standard";

      if (shopDomain === session.shop) {
        try {
          const res = await admin.graphql(`
            query {
              shop {
                name
                myshopifyDomain
                plan { displayName }
              }
              appInstallation {
                createdAt
              }
            }
          `);
          const data = await res.json();
          if (data.data?.shop?.name) shopName = data.data.shop.name;
          if (data.data?.shop?.plan?.displayName) shopifyPlan = data.data.shop.plan.displayName;
          if (data.data?.appInstallation?.createdAt) installedAt = data.data.appInstallation.createdAt;
        } catch (e) {
          console.warn("[Admin] Current shop GraphQL note:", e.message);
        }
      } else {
        // Try unauthenticated admin client first
        let fetchedOk = false;
        try {
          const unauth = await unauthenticated.admin(shopDomain);
          if (unauth?.admin) {
            const res = await unauth.admin.graphql(`
              query {
                shop {
                  name
                  plan { displayName }
                }
                appInstallation {
                  createdAt
                }
              }
            `);
            const data = await res.json();
            if (data.data?.shop?.name) {
              shopName = data.data.shop.name;
              fetchedOk = true;
            }
            if (data.data?.shop?.plan?.displayName) shopifyPlan = data.data.shop.plan.displayName;
            if (data.data?.appInstallation?.createdAt) installedAt = data.data.appInstallation.createdAt;
          }
        } catch (unauthErr) {}

        // Fallback to fetch with sess.accessToken if available
        if (!fetchedOk && sess?.accessToken) {
          try {
            const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Shopify-Access-Token": sess.accessToken,
              },
              body: JSON.stringify({
                query: `{
                  shop {
                    name
                    plan { displayName }
                  }
                  appInstallation {
                    createdAt
                  }
                }`,
              }),
            });
            const data = await res.json();
            if (data.data?.shop?.name) shopName = data.data.shop.name;
            if (data.data?.shop?.plan?.displayName) shopifyPlan = data.data.shop.plan.displayName;
            if (data.data?.appInstallation?.createdAt) installedAt = data.data.appInstallation.createdAt;
          } catch (e) {}
        }
      }

      const blockInfo = blockedMap[shopDomain];

      return {
        id: shopDomain,
        shop: shopDomain,
        shopName,
        ownerEmail,
        shopifyPlan,
        installedAt,
        manualPlan: overrideMap[shopDomain]?.plan || "NONE",
        testimonialCount: testimonialCountMap[shopDomain] || 0,
        monthlyViews: viewCountMap[shopDomain] || 0,
        isBlocked: !!blockInfo,
        blockReason: blockInfo?.reason || "",
        hasActiveSession: !!sess,
      };
    })
  );

  const stats = {
    totalStores: stores.length,
    activePaid: stores.filter((s) => s.manualPlan === "MONTHLY" || s.manualPlan === "LIFETIME").length,
    blockedStores: stores.filter((s) => s.isBlocked).length,
    totalTestimonials: Object.values(testimonialCountMap).reduce((a, b) => a + b, 0),
  };

  return json({ stores, stats, currentShop: session.shop });
};

export const action = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const actionType = formData.get("action");
  const targetShopRaw = formData.get("targetShop")?.trim().toLowerCase();
  
  if (!targetShopRaw) {
    return json({ error: "Store domain is required" }, { status: 400 });
  }

  // Normalize domain
  const targetShop = targetShopRaw.includes(".myshopify.com")
    ? targetShopRaw
    : `${targetShopRaw}.myshopify.com`;

  if (actionType === "update_plan") {
    const plan = formData.get("plan");
    let hasPaidPlan = false;
    let planName = "Free Starter";

    if (plan === "NONE") {
      await prisma.storePlanOverride.deleteMany({ where: { shop: targetShop } });
    } else {
      await prisma.storePlanOverride.upsert({
        where: { shop: targetShop },
        update: { plan },
        create: { shop: targetShop, plan },
      });
      hasPaidPlan = true;
      planName = plan === "MONTHLY" ? "Monthly Pro" : plan === "LIFETIME" ? "Lifetime Plan" : "Free Plan";
    }

    // Sync to metafields if it's the current store
    try {
      if (targetShop === session.shop) {
        await syncTestimonialsToMetafields(admin, targetShop, hasPaidPlan, planName);
      }
    } catch (e) {
      console.warn("Could not sync metafields for", targetShop, e);
    }
  }

  if (actionType === "block_store") {
    const reason = formData.get("reason") || "";
    await prisma.blockedStore.upsert({
      where: { shop: targetShop },
      update: { reason },
      create: { shop: targetShop, reason },
    });

    // Sync metafields to lock storefront if current shop
    try {
      if (targetShop === session.shop) {
        await syncTestimonialsToMetafields(admin, targetShop, false, "Account Suspended");
      }
    } catch (e) {}
  }

  if (actionType === "unblock_store") {
    await prisma.blockedStore.deleteMany({ where: { shop: targetShop } });

    // Restore storefront metafields if current shop
    try {
      if (targetShop === session.shop) {
        const override = await prisma.storePlanOverride.findUnique({ where: { shop: targetShop } });
        const hasPaid = override ? override.plan !== "FREE" : false;
        await syncTestimonialsToMetafields(admin, targetShop, hasPaid);
      }
    } catch (e) {}
  }

  return json({ success: true });
};

export default function AdminDashboard() {
  const { stores, stats, isUnauthorized, currentShop } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isUpdating = nav.state !== "idle";

  const [blockModal, setBlockModal] = useState(null); // { shop, shopName }
  const [blockReason, setBlockReason] = useState("");
  const [newStoreDomain, setNewStoreDomain] = useState("");
  const [newStorePlan, setNewStorePlan] = useState("LIFETIME");

  const handlePlanChange = (shop, newPlan) => {
    const formData = new FormData();
    formData.append("action", "update_plan");
    formData.append("targetShop", shop);
    formData.append("plan", newPlan);
    submit(formData, { method: "post" });
  };

  const handleOpenBlockModal = useCallback((shop, shopName) => {
    setBlockReason("");
    setBlockModal({ shop, shopName });
  }, []);

  const handleConfirmBlock = useCallback(() => {
    if (!blockModal) return;
    const formData = new FormData();
    formData.append("action", "block_store");
    formData.append("targetShop", blockModal.shop);
    formData.append("reason", blockReason);
    submit(formData, { method: "post" });
    setBlockModal(null);
  }, [blockModal, blockReason, submit]);

  const handleUnblock = useCallback((shop) => {
    const formData = new FormData();
    formData.append("action", "unblock_store");
    formData.append("targetShop", shop);
    submit(formData, { method: "post" });
  }, [submit]);

  const handleAddManualStore = useCallback(() => {
    if (!newStoreDomain.trim()) return;
    const formData = new FormData();
    formData.append("action", "update_plan");
    formData.append("targetShop", newStoreDomain.trim());
    formData.append("plan", newStorePlan);
    submit(formData, { method: "post" });
    setNewStoreDomain("");
  }, [newStoreDomain, newStorePlan, submit]);

  if (isUnauthorized) {
    return (
      <Page>
        <TitleBar title="Access Denied" />
        <div style={{ textAlign: "center", padding: "80px 20px" }}>
          <div style={{ fontSize: "48px", marginBottom: "16px" }}>🔒</div>
          <Text variant="headingXl" as="h1">Access Denied</Text>
          <div style={{ marginTop: "12px" }}>
            <Text tone="subdued" as="p">This page is restricted to super admins only.</Text>
            <Text tone="subdued" as="p">Set the ADMIN_SHOP environment variable on Render to grant access.</Text>
          </div>
        </div>
      </Page>
    );
  }

  const rowMarkup = stores.map(
    (
      {
        id,
        shop,
        shopName,
        ownerEmail,
        shopifyPlan,
        installedAt,
        manualPlan,
        testimonialCount,
        monthlyViews,
        isBlocked,
        blockReason: reason,
      },
      index
    ) => {
      const dateDisplay = installedAt
        ? new Date(installedAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
        : "Installed";

      const isCurrentShop = shop === currentShop;

      return (
        <IndexTable.Row
          id={id}
          key={id}
          position={index}
          tone={isBlocked ? "critical" : undefined}
        >
          <IndexTable.Cell>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodyMd" fontWeight="bold" as="span">
                  {shopName}
                </Text>
                {isCurrentShop && <Badge tone="info">You</Badge>}
                {isBlocked && <Badge tone="critical">🚫 Blocked</Badge>}
              </InlineStack>
              <Text tone="subdued" variant="bodySm" as="span">
                {shop}
              </Text>
              {isBlocked && reason && (
                <Text tone="critical" variant="bodySm" as="span">
                  Reason: {reason}
                </Text>
              )}
            </BlockStack>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Badge tone="subdued">{shopifyPlan}</Badge>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Text as="span">{testimonialCount} reels</Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Text as="span">{monthlyViews.toLocaleString()} views</Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Text as="span">{dateDisplay}</Text>
          </IndexTable.Cell>

          <IndexTable.Cell>
            <Select
              label="Manual Plan"
              labelHidden
              options={[
                { label: "None (Shopify Billing)", value: "NONE" },
                { label: "Free Plan", value: "FREE" },
                { label: "Monthly Pro ($2/mo)", value: "MONTHLY" },
                { label: "Lifetime Access ($10)", value: "LIFETIME" },
              ]}
              value={manualPlan}
              onChange={(val) => handlePlanChange(shop, val)}
              disabled={isUpdating || isBlocked}
            />
          </IndexTable.Cell>

          <IndexTable.Cell>
            {isBlocked ? (
              <Button
                tone="success"
                size="slim"
                onClick={() => handleUnblock(shop)}
                disabled={isUpdating}
              >
                ✅ Unblock
              </Button>
            ) : (
              <Button
                tone="critical"
                size="slim"
                onClick={() => handleOpenBlockModal(shop, shopName)}
                disabled={isUpdating}
              >
                🚫 Block
              </Button>
            )}
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page fullWidth>
      <TitleBar title="Super Admin Dashboard" />

      {/* Block Confirmation Modal */}
      <Modal
        open={!!blockModal}
        onClose={() => setBlockModal(null)}
        title={`Block "${blockModal?.shopName}"?`}
        primaryAction={{
          content: "Confirm Block & Suspend Service",
          destructive: true,
          onAction: handleConfirmBlock,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBlockModal(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              This will <strong>suspend all service</strong> for <strong>{blockModal?.shop}</strong>:
            </Text>
            <Text as="p" tone="critical">
              • App admin access will be suspended<br />
              • Storefront video reels section will be disabled/paused on their live store
            </Text>
            <TextField
              label="Reason for blocking (shown on suspended screen)"
              value={blockReason}
              onChange={setBlockReason}
              placeholder="e.g. Terms violation, chargeback, or test suspension"
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        {/* Metric Cards Banner */}
        <Layout>
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Total Stores Connected</Text>
                <Text variant="heading2xl" as="h3">{stats.totalStores || 0}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Active Paid Overrides</Text>
                <Text variant="heading2xl" as="h3" tone="success">{stats.activePaid || 0}</Text>
              </BlockStack>
            </Card>
          </Layout.Section>
          <Layout.Section variant="oneThird">
            <Card padding="400">
              <BlockStack gap="100">
                <Text variant="bodySm" tone="subdued">Blocked Stores</Text>
                <Text variant="heading2xl" as="h3" tone={stats.blockedStores > 0 ? "critical" : "subdued"}>
                  {stats.blockedStores || 0}
                </Text>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>

        {/* Quick Add / Manage Any Store */}
        <Card>
          <BlockStack gap="300">
            <Text variant="headingSm" as="h2">Assign Plan to Any Store (Even If Not Listed)</Text>
            <Text variant="bodySm" tone="subdued">
              You can manually pre-assign a Lifetime or Monthly plan to any test store or client by entering their myshopify domain.
            </Text>
            <InlineStack gap="300" blockAlign="end">
              <Box minWidth="300px">
                <TextField
                  label="Store Domain"
                  value={newStoreDomain}
                  onChange={setNewStoreDomain}
                  placeholder="e.g. store-name.myshopify.com"
                  autoComplete="off"
                />
              </Box>
              <Box minWidth="200px">
                <Select
                  label="Plan to Assign"
                  options={[
                    { label: "Lifetime Access ($10 Value)", value: "LIFETIME" },
                    { label: "Monthly Pro ($2/mo Value)", value: "MONTHLY" },
                    { label: "Free Starter Plan", value: "FREE" },
                  ]}
                  value={newStorePlan}
                  onChange={setNewStorePlan}
                />
              </Box>
              <Button variant="primary" onClick={handleAddManualStore} loading={isUpdating}>
                Assign Plan
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>

        {/* Stores Table */}
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "store", plural: "stores" }}
                itemCount={stores.length}
                headings={[
                  { title: "Store Name / Domain" },
                  { title: "Shopify Plan" },
                  { title: "Reels" },
                  { title: "Views (This Mo)" },
                  { title: "Installed Date" },
                  { title: "Manual Plan Override" },
                  { title: "Actions" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
      <div style={{ height: "40px" }} />
    </Page>
  );
}

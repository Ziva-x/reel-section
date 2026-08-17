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
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { useState, useCallback } from "react";

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);

  // Security Check
  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return json({ isUnauthorized: true, stores: [], stats: {}, currentShop: session.shop });
  }

  // 1. Collect all shop domains from database
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

  // 4. Build store details from database (no external slow GraphQL calls)
  const stores = uniqueShops.map((shopDomain) => {
    const blockInfo = blockedMap[shopDomain];
    const override = overrideMap[shopDomain];

    return {
      id: shopDomain,
      shop: shopDomain,
      manualPlan: override?.plan || "NONE",
      testimonialCount: testimonialCountMap[shopDomain] || 0,
      monthlyViews: viewCountMap[shopDomain] || 0,
      isBlocked: !!blockInfo,
      blockReason: blockInfo?.reason || "",
    };
  });

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

  const [blockModal, setBlockModal] = useState(null); // { shop }
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

  const handleOpenBlockModal = useCallback((shop) => {
    setBlockReason("");
    setBlockModal({ shop });
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
    ({ id, shop, manualPlan, testimonialCount, monthlyViews, isBlocked, blockReason: reason }, index) => {
      const isCurrentShop = shop === currentShop;

      return (
        <IndexTable.Row
          id={id}
          key={id}
          position={index}
          tone={isBlocked ? "critical" : undefined}
        >
          {/* Store Domain */}
          <IndexTable.Cell>
            <BlockStack gap="050">
              <InlineStack gap="200" blockAlign="center">
                <Text variant="bodyMd" fontWeight="bold" as="span">
                  {shop}
                </Text>
                {isCurrentShop && <Badge tone="info">Your Test Store</Badge>}
                {isBlocked && <Badge tone="critical">🚫 Blocked</Badge>}
              </InlineStack>
              {isBlocked && reason && (
                <Text tone="critical" variant="bodySm" as="span">
                  Reason: {reason}
                </Text>
              )}
            </BlockStack>
          </IndexTable.Cell>

          {/* Our App Plan */}
          <IndexTable.Cell>
            {isBlocked ? (
              <Badge tone="critical">🚫 Suspended</Badge>
            ) : manualPlan === "LIFETIME" ? (
              <Badge tone="success">⭐ Lifetime Access ($10)</Badge>
            ) : manualPlan === "MONTHLY" ? (
              <Badge tone="success">✨ Monthly Pro ($2/mo)</Badge>
            ) : manualPlan === "FREE" ? (
              <Badge tone="info">Free Starter (Manual)</Badge>
            ) : (
              <Badge tone="info">Free Starter</Badge>
            )}
          </IndexTable.Cell>

          {/* Testimonials / Reels Count */}
          <IndexTable.Cell>
            <Text as="span" fontWeight="semibold">
              {testimonialCount} {testimonialCount === 1 ? "reel" : "reels"}
            </Text>
          </IndexTable.Cell>

          {/* Monthly Views */}
          <IndexTable.Cell>
            <Text as="span">
              {monthlyViews.toLocaleString()} views
            </Text>
          </IndexTable.Cell>

          {/* Manual Plan Dropdown */}
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

          {/* Block / Unblock Actions */}
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
                onClick={() => handleOpenBlockModal(shop)}
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
        title={`Block "${blockModal?.shop}"?`}
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
              • App access will be locked down (they can only see Settings to contact you)<br />
              • Storefront video reels section will be disabled/hidden on their live store
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
        {/* Metric Cards */}
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
                <Text variant="bodySm" tone="subdued">Active Paid Plans</Text>
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
              You can pre-assign Lifetime or Monthly Pro to any store domain before or after install.
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
                  { title: "Store Domain" },
                  { title: "Our Plan Details" },
                  { title: "Reels" },
                  { title: "Views (This Mo)" },
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

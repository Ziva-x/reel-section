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
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { useState, useCallback } from "react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  // Security Check
  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return json({ isUnauthorized: true, stores: [] });
  }

  // 1. Get all sessions and deduplicate by shop
  //    Prefer offline sessions (they have the long-lived accessToken)
  const allSessions = await prisma.session.findMany({
    orderBy: { shop: "asc" },
  });

  // Deduplicate: prefer offline session per shop, fallback to any
  const shopMap = {};
  for (const sess of allSessions) {
    if (!shopMap[sess.shop]) {
      shopMap[sess.shop] = sess;
    } else if (!sess.isOnline) {
      shopMap[sess.shop] = sess;
    }
  }
  const uniqueSessions = Object.values(shopMap);

  // 2. Get all manual overrides and blocked stores
  const overrides = await prisma.storePlanOverride.findMany();
  const overrideMap = {};
  overrides.forEach((o) => {
    overrideMap[o.shop] = { plan: o.plan };
  });

  const blockedStores = await prisma.blockedStore.findMany();
  const blockedMap = {};
  blockedStores.forEach((b) => {
    blockedMap[b.shop] = { reason: b.reason, blockedAt: b.blockedAt };
  });

  // 3. For each shop, use the accessToken to query Shopify GraphQL directly
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

  const stores = await Promise.all(
    uniqueSessions.map(async (sess) => {
      let installedAt = null;
      let shopName = null;
      let ownerEmail = null;

      try {
        const gqlResponse = await fetch(
          `https://${sess.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Shopify-Access-Token": sess.accessToken,
            },
            body: JSON.stringify({
              query: `{
                shop {
                  name
                  email
                  myshopifyDomain
                }
                appInstallation {
                  createdAt
                }
              }`,
            }),
          }
        );
        const gqlData = await gqlResponse.json();
        const shopData = gqlData.data?.shop;
        installedAt = gqlData.data?.appInstallation?.createdAt || null;
        shopName = shopData?.name || null;
        ownerEmail = shopData?.email || null;
      } catch (e) {
        console.warn(`Could not fetch Shopify data for ${sess.shop}:`, e.message);
      }

      const blockInfo = blockedMap[sess.shop];

      return {
        id: sess.shop,
        shop: sess.shop,
        shopName: shopName || sess.shop,
        ownerEmail: ownerEmail || sess.email || "N/A",
        installedAt,
        manualPlan: overrideMap[sess.shop]?.plan || "NONE",
        isBlocked: !!blockInfo,
        blockReason: blockInfo?.reason || "",
        blockedAt: blockInfo?.blockedAt || null,
      };
    })
  );

  return json({ stores });
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);

  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return json({ error: "Unauthorized" }, { status: 403 });
  }

  const formData = await request.formData();
  const actionType = formData.get("action");
  const targetShop = formData.get("targetShop");

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
      planName = plan;
    }

    // Sync to metafields if it's the admin's own shop
    try {
      if (targetShop === session.shop) {
        const { admin } = await authenticate.admin(request);
        await syncTestimonialsToMetafields(admin, targetShop, hasPaidPlan, planName);
      }
    } catch (e) {
      console.warn("Could not sync to metafields for", targetShop, e);
    }
  }

  if (actionType === "block_store") {
    const reason = formData.get("reason") || "";
    await prisma.blockedStore.upsert({
      where: { shop: targetShop },
      update: { reason },
      create: { shop: targetShop, reason },
    });
  }

  if (actionType === "unblock_store") {
    await prisma.blockedStore.deleteMany({ where: { shop: targetShop } });
  }

  return json({ success: true });
};

export default function AdminDashboard() {
  const { stores, isUnauthorized } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();
  const isUpdating = nav.state !== "idle";

  const [blockModal, setBlockModal] = useState(null); // { shop, shopName }
  const [blockReason, setBlockReason] = useState("");

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
    ({ id, shop, shopName, ownerEmail, installedAt, manualPlan, isBlocked, blockReason: reason, blockedAt }, index) => {
      const dateDisplay = installedAt
        ? new Date(installedAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
        : "Unknown";

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
                {isBlocked && <Badge tone="critical">Blocked</Badge>}
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
            <Text as="span">{ownerEmail}</Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            {dateDisplay}
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Select
              label="Manual Plan"
              labelHidden
              options={[
                { label: "None (Shopify Billing)", value: "NONE" },
                { label: "Free Plan", value: "FREE" },
                { label: "Monthly Pro", value: "MONTHLY" },
                { label: "Lifetime Access", value: "LIFETIME" },
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
          content: "Confirm Block",
          destructive: true,
          onAction: handleConfirmBlock,
        }}
        secondaryActions={[{ content: "Cancel", onAction: () => setBlockModal(null) }]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text as="p">
              This will prevent <strong>{blockModal?.shop}</strong> from accessing the app. Their existing storefront reels will remain unaffected.
            </Text>
            <TextField
              label="Reason for blocking (shown to the store owner)"
              value={blockReason}
              onChange={setBlockReason}
              placeholder="e.g. Suspected abuse of free trial, Chargebacks, etc."
              multiline={2}
              autoComplete="off"
            />
          </BlockStack>
        </Modal.Section>
      </Modal>

      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card padding="0">
              <IndexTable
                resourceName={{ singular: "store", plural: "stores" }}
                itemCount={stores.length}
                headings={[
                  { title: "Store Name / Domain" },
                  { title: "Owner Email" },
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

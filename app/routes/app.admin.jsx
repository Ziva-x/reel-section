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
  BlockStack
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";

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
      // Prefer offline session (has the app-level access token)
      shopMap[sess.shop] = sess;
    }
  }
  const uniqueSessions = Object.values(shopMap);

  // 2. Get all manual overrides
  const overrides = await prisma.storePlanOverride.findMany();
  const overrideMap = {};
  overrides.forEach(o => {
    overrideMap[o.shop] = { plan: o.plan, createdAt: o.createdAt };
  });

  // 3. For each shop, use the accessToken to query Shopify GraphQL directly
  const SHOPIFY_API_VERSION = process.env.SHOPIFY_API_VERSION || "2025-01";

  const stores = await Promise.all(
    uniqueSessions.map(async (sess) => {
      let installedAt = null;
      let ownerName = null;
      let ownerEmail = null;
      let shopName = null;

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
                  plan { displayName }
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

      return {
        id: sess.shop,
        shop: sess.shop,
        shopName: shopName || sess.shop,
        ownerEmail: ownerEmail || sess.email || "N/A",
        installedAt,
        manualPlan: overrideMap[sess.shop]?.plan || "NONE",
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
  const plan = formData.get("plan");

  if (actionType === "update_plan") {
    let hasPaidPlan = false;
    let planName = "Free Starter";

    if (plan === "NONE") {
      await prisma.storePlanOverride.deleteMany({
        where: { shop: targetShop }
      });
    } else {
      await prisma.storePlanOverride.upsert({
        where: { shop: targetShop },
        update: { plan },
        create: { shop: targetShop, plan },
      });
      hasPaidPlan = true;
      planName = plan;
    }

    // Attempt to sync immediately using the stored access token
    try {
      const targetSession = await prisma.session.findFirst({
        where: { shop: targetShop, isOnline: false },
      });
      if (targetSession) {
        const { admin } = await authenticate.admin(request);
        // Use the current admin session if same shop, otherwise skip sync (will sync on next page load)
        if (targetShop === session.shop) {
          await syncTestimonialsToMetafields(admin, targetShop, hasPaidPlan, planName);
        }
      }
    } catch (e) {
      console.warn("Could not sync to metafields for", targetShop, e);
    }
  }

  return json({ success: true });
};

export default function AdminDashboard() {
  const { stores, isUnauthorized } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();

  const isUpdating = nav.state !== "idle";

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

  const handlePlanChange = (shop, newPlan) => {
    const formData = new FormData();
    formData.append("action", "update_plan");
    formData.append("targetShop", shop);
    formData.append("plan", newPlan);
    submit(formData, { method: "post" });
  };

  const rowMarkup = stores.map(
    ({ id, shop, shopName, ownerEmail, installedAt, manualPlan }, index) => {
      const dateDisplay = installedAt
        ? new Date(installedAt).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
        : "Unknown";

      return (
        <IndexTable.Row id={id} key={id} position={index}>
          <IndexTable.Cell>
            <BlockStack gap="050">
              <Text variant="bodyMd" fontWeight="bold" as="span">
                {shopName}
              </Text>
              <Text tone="subdued" variant="bodySm" as="span">
                {shop}
              </Text>
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
                { label: "Lifetime Access", value: "LIFETIME" }
              ]}
              value={manualPlan}
              onChange={(val) => handlePlanChange(shop, val)}
              disabled={isUpdating}
            />
          </IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page fullWidth>
      <TitleBar title="Super Admin Dashboard" />
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

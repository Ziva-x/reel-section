import { json, redirect } from "@remix-run/node";
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
import { authenticate, unauthenticated } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  
  // Security Check
  const adminShop = process.env.ADMIN_SHOP;
  if (!adminShop || session.shop !== adminShop) {
    return redirect("/app");
  }

  // 1. Get all unique installed shops from Session table
  const sessions = await prisma.session.findMany({
    where: { isOnline: false }, // usually offline sessions are the long-lived ones
  });

  // 2. Get all manual overrides
  const overrides = await prisma.storePlanOverride.findMany();
  const overrideMap = {};
  overrides.forEach(o => {
    overrideMap[o.shop] = o.plan;
  });

  // 3. Fetch appInstallation date for each shop using unauthenticated admin API
  const stores = await Promise.all(
    sessions.map(async (sess) => {
      let installedAt = "Unknown";
      try {
        const { admin } = await unauthenticated.admin(sess.shop);
        const response = await admin.graphql(`
          query {
            appInstallation {
              createdAt
            }
          }
        `);
        const data = await response.json();
        installedAt = data.data?.appInstallation?.createdAt || "Unknown";
      } catch (e) {
        // If the unauthenticated request fails (e.g., app was uninstalled but session remains)
        installedAt = "Uninstalled/Error";
      }

      return {
        id: sess.shop,
        shop: sess.shop,
        firstName: sess.firstName || "",
        lastName: sess.lastName || "",
        email: sess.email || "N/A",
        installedAt,
        manualPlan: overrideMap[sess.shop] || "NONE",
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

    // Attempt to sync immediately via unauthenticated API
    try {
      const { admin } = await unauthenticated.admin(targetShop);
      await syncTestimonialsToMetafields(admin, targetShop, hasPaidPlan, planName);
    } catch (e) {
      console.warn("Could not sync to metafields for", targetShop, e);
    }
  }

  return json({ success: true });
};

export default function AdminDashboard() {
  const { stores } = useLoaderData();
  const submit = useSubmit();
  const nav = useNavigation();

  const isUpdating = nav.state !== "idle";

  const handlePlanChange = (shop, newPlan) => {
    const formData = new FormData();
    formData.append("action", "update_plan");
    formData.append("targetShop", shop);
    formData.append("plan", newPlan);
    submit(formData, { method: "post" });
  };

  const rowMarkup = stores.map(
    ({ id, shop, firstName, lastName, email, installedAt, manualPlan }, index) => {
      const name = [firstName, lastName].filter(Boolean).join(" ") || "Unknown";
      
      const dateDisplay = installedAt !== "Unknown" && installedAt !== "Uninstalled/Error"
        ? new Date(installedAt).toLocaleDateString()
        : installedAt;

      return (
        <IndexTable.Row id={id} key={id} position={index}>
          <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold" as="span">
              {shop}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <BlockStack gap="100">
              <Text as="span">{name}</Text>
              <Text tone="subdued" as="span">{email}</Text>
            </BlockStack>
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
                  { title: "Shop Domain" },
                  { title: "Merchant Info" },
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

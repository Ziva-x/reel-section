import { useEffect } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  IndexTable,
  useIndexResourceState,
  Badge,
  Banner,
  InlineStack,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { syncTestimonialsToMetafields } from "../metafields.server";
import { LIFETIME_PLAN } from "../constants";

export const loader = async ({ request }) => {
  const { session, admin, billing } = await authenticate.admin(request);
  const testimonials = await prisma.testimonial.findMany({
    where: { shop: session.shop },
    orderBy: { createdAt: "desc" },
  });

  let hasLifetime = false;
  try {
    const billingCheck = await billing.check({
      plans: [LIFETIME_PLAN],
      isTest: true,
    });
    hasLifetime = !!billingCheck.hasActivePayment;
  } catch (e) {
    hasLifetime = false;
  }

  // Background sync testimonials to Shop Metafields so storefront is guaranteed in sync
  syncTestimonialsToMetafields(admin, session.shop, hasLifetime).catch(() => {});

  return json({ testimonials, hasLifetime });
};

export default function Index() {
  const { testimonials, hasLifetime } = useLoaderData();
  const navigate = useNavigate();

  const { selectedResources, allResourcesSelected, handleSelectionChange } =
    useIndexResourceState(testimonials);

  const rowMarkup = testimonials.map(
    (
      { id, customerName, rating, verified, productHandle, createdAt },
      index,
    ) => (
      <IndexTable.Row
        id={id.toString()}
        key={id}
        selected={selectedResources.includes(id.toString())}
        position={index}
        onClick={() => navigate(`/app/testimonials/${id}`)}
      >
        <IndexTable.Cell>
          <Text variant="bodyMd" fontWeight="bold" as="span">
            {customerName}
          </Text>
        </IndexTable.Cell>
        <IndexTable.Cell>{rating} / 5 ★</IndexTable.Cell>
        <IndexTable.Cell>
          {verified ? <Badge tone="success">Verified</Badge> : <Badge tone="subdued">Standard</Badge>}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {productHandle ? (
            <Badge tone="success">🛍️ {productHandle}</Badge>
          ) : (
            <Badge tone="subdued">All Products</Badge>
          )}
        </IndexTable.Cell>
        <IndexTable.Cell>
          {new Date(createdAt).toLocaleDateString()}
        </IndexTable.Cell>
      </IndexTable.Row>
    ),
  );

  return (
    <Page>
      <TitleBar title="Video Testimonials">
        <button variant="primary" onClick={() => navigate("/app/testimonials/new")}>
          Create Testimonial
        </button>
      </TitleBar>
      <BlockStack gap="500">
        {hasLifetime && (
          <Banner tone="success" title="⭐ Lifetime Pro Active">
            <p>
              Your store has unlocked <strong>Unlimited Impressions</strong>, <strong>Click-to-Shop Liquid Glass Product Tags</strong>, and <strong>Full Customization</strong>.
            </p>
          </Banner>
        )}

        <Layout>
          <Layout.Section>
            <Card padding="0">
              {testimonials.length === 0 ? (
                <div style={{ padding: "40px", textAlign: "center" }}>
                  <Text as="p" variant="bodyMd">
                    No testimonials found. Create your first video story to get started!
                  </Text>
                  <div style={{ marginTop: "16px" }}>
                    <Button onClick={() => navigate("/app/testimonials/new")} variant="primary">
                      Create Testimonial
                    </Button>
                  </div>
                </div>
              ) : (
                <IndexTable
                  resourceName={{ singular: "testimonial", plural: "testimonials" }}
                  itemCount={testimonials.length}
                  selectedItemsCount={
                    allResourcesSelected ? "All" : selectedResources.length
                  }
                  onSelectionChange={handleSelectionChange}
                  headings={[
                    { title: "Customer" },
                    { title: "Rating" },
                    { title: "Badge" },
                    { title: "Tagged Product" },
                    { title: "Created At" },
                  ]}
                >
                  {rowMarkup}
                </IndexTable>
              )}
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}

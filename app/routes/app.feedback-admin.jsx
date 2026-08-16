import { useState } from "react";
import { json } from "@remix-run/node";
import { useLoaderData, Form, useSubmit, useNavigation } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  IndexTable,
  Badge,
  TextField,
  Button,
  InlineStack,
  EmptySearchResult,
  Box,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  const url = new URL(request.url);
  const passcode = url.searchParams.get("passcode");
  
  if (passcode !== "monkeygarage") {
    return json({ isAuthenticated: false, feedback: [] });
  }

  const feedback = await prisma.feedback.findMany({
    orderBy: { createdAt: "desc" }
  });

  return json({ isAuthenticated: true, feedback });
};

export default function FeedbackAdmin() {
  const { isAuthenticated, feedback } = useLoaderData();
  const [passcode, setPasscode] = useState("");
  const submit = useSubmit();
  const nav = useNavigation();

  if (!isAuthenticated) {
    return (
      <Page title="🔒 Developer Area">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text variant="headingMd" as="h2">Authentication Required</Text>
                <Text as="p">Please enter the master password to view merchant feedback.</Text>
                <Form method="get">
                  <InlineStack gap="300" align="start">
                    <TextField
                      name="passcode"
                      value={passcode}
                      onChange={setPasscode}
                      type="password"
                      autoComplete="off"
                      placeholder="Enter passcode..."
                    />
                    <Button submit variant="primary" loading={nav.state === "loading"}>Unlock</Button>
                  </InlineStack>
                </Form>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </Page>
    );
  }

  const rowMarkup = feedback.map(
    ({ id, shop, email, rating, type, message, createdAt }, index) => {
      let typeBadge;
      if (type === "bug") {
        typeBadge = <Badge tone="critical">🐛 Bug / Complaint</Badge>;
      } else if (type === "feature") {
        typeBadge = <Badge tone="info">💡 Feature Request</Badge>;
      } else {
        typeBadge = <Badge tone="success">⭐ General Feedback</Badge>;
      }

      return (
        <IndexTable.Row id={id} key={id} position={index}>
          <IndexTable.Cell>
            <Text variant="bodyMd" fontWeight="bold">{shop}</Text>
            {email && <Text tone="subdued">{email}</Text>}
          </IndexTable.Cell>
          <IndexTable.Cell>{typeBadge}</IndexTable.Cell>
          <IndexTable.Cell>{rating} / 5</IndexTable.Cell>
          <IndexTable.Cell>
            <div style={{ whiteSpace: "normal", minWidth: "250px", maxWidth: "400px" }}>
              {message}
            </div>
          </IndexTable.Cell>
          <IndexTable.Cell>{new Date(createdAt).toLocaleDateString()}</IndexTable.Cell>
        </IndexTable.Row>
      );
    }
  );

  return (
    <Page title="👨‍💻 Developer Dashboard - Feedback">
      <Layout>
        <Layout.Section>
          <Card padding="0">
            {feedback.length === 0 ? (
              <Box padding="400">
                <EmptySearchResult
                  title="No feedback yet"
                  description="When merchants submit feedback, bug reports, or feature requests, they will appear here."
                  withIllustration
                />
              </Box>
            ) : (
              <IndexTable
                resourceName={{ singular: "feedback", plural: "feedback entries" }}
                itemCount={feedback.length}
                headings={[
                  { title: "Store & Email" },
                  { title: "Type" },
                  { title: "Rating" },
                  { title: "Message" },
                  { title: "Date" },
                ]}
                selectable={false}
              >
                {rowMarkup}
              </IndexTable>
            )}
          </Card>
        </Layout.Section>
      </Layout>
      <div style={{ height: "40px" }} />
    </Page>
  );
}

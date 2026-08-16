import { useState } from "react";
import { json } from "@remix-run/node";
import { useActionData, useNavigation, useSubmit, useNavigate } from "@remix-run/react";
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
  EmptyState,
  Box,
  Banner,
  Divider,
} from "@shopify/polaris";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return json({ ok: true });
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const passcode = formData.get("passcode");

  if (passcode !== "monkeygarage") {
    return json({ success: false, error: "Incorrect master passcode. Access denied." });
  }

  try {
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
    });
    return json({ success: true, feedback });
  } catch (err) {
    return json({ success: false, error: "Database error: " + (err.message || String(err)) });
  }
};

export default function FeedbackAdmin() {
  const actionData = useActionData();
  const navigate = useNavigate();
  const nav = useNavigation();
  const submit = useSubmit();
  const [passcode, setPasscode] = useState("");

  const isSubmitting = nav.state === "submitting";
  const isAuthenticated = actionData?.success === true;
  const feedbackList = actionData?.feedback || [];

  const handleUnlock = () => {
    if (!passcode) return;
    submit({ passcode }, { method: "post" });
  };

  return (
    <Page
      title="👨‍💻 Developer Dashboard"
      subtitle="Private portal for MonkeyGarage engineering"
      backAction={{ content: "Settings", onAction: () => navigate("/app/settings") }}
    >
      <Layout>
        <Layout.Section>
          {!isAuthenticated ? (
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center">
                  <Text variant="headingMd" as="h2">🔒 Security Verification</Text>
                  <Badge tone="attention">Admin Only</Badge>
                </InlineStack>
                <Text as="p" tone="subdued">
                  Enter your master developer passcode to view merchant feedback, bug reports, and suggestions.
                </Text>

                {actionData?.error && (
                  <Banner tone="critical">
                    <p>{actionData.error}</p>
                  </Banner>
                )}

                <InlineStack gap="300" blockAlign="end">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Developer Passcode"
                      value={passcode}
                      onChange={setPasscode}
                      type="password"
                      autoComplete="off"
                      placeholder="Enter master passcode..."
                    />
                  </div>
                  <Button
                    variant="primary"
                    onClick={handleUnlock}
                    loading={isSubmitting}
                    disabled={!passcode.trim()}
                  >
                    Unlock Portal
                  </Button>
                </InlineStack>
              </BlockStack>
            </Card>
          ) : (
            <Card padding="0">
              <Box padding="400">
                <InlineStack align="space-between" blockAlign="center">
                  <div>
                    <Text variant="headingMd" as="h2">Merchant Feedback & Reports</Text>
                    <Text variant="bodySm" tone="subdued">Total Entries: {feedbackList.length}</Text>
                  </div>
                  <Button onClick={handleUnlock} loading={isSubmitting}>Refresh Data</Button>
                </InlineStack>
              </Box>
              <Divider />

              {feedbackList.length === 0 ? (
                <Box padding="400">
                  <EmptyState
                    heading="No submissions recorded yet"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>Submissions from the Settings feedback form will appear here in real time.</p>
                  </EmptyState>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "submission", plural: "submissions" }}
                  itemCount={feedbackList.length}
                  headings={[
                    { title: "Store & Email" },
                    { title: "Category" },
                    { title: "Rating" },
                    { title: "Message" },
                    { title: "Date" },
                  ]}
                  selectable={false}
                >
                  {feedbackList.map(({ id, shop, email, rating, type, message, createdAt }, index) => {
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
                          {email ? <Text variant="bodySm" tone="subdued">{email}</Text> : <Text variant="bodySm" tone="subdued">No email provided</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{typeBadge}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text fontWeight="semibold">{rating} / 5 ⭐</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ whiteSpace: "normal", minWidth: "220px", maxWidth: "400px", lineHeight: "1.4" }}>
                            {message}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm" tone="subdued">
                            {new Date(createdAt).toLocaleString()}
                          </Text>
                        </IndexTable.Cell>
                      </IndexTable.Row>
                    );
                  })}
                </IndexTable>
              )}
            </Card>
          )}
        </Layout.Section>
      </Layout>
      <div style={{ height: "60px" }} />
    </Page>
  );
}

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
  Tabs,
  Modal,
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
  const actionType = formData.get("_action");

  if (passcode !== "monkeygarage") {
    return json({ success: false, error: "Incorrect master passcode. Access denied." });
  }

  try {
    // Delete single submission
    if (actionType === "delete") {
      const id = parseInt(formData.get("id"), 10);
      if (id) {
        await prisma.feedback.delete({
          where: { id },
        });
      }
    }

    // Delete all submissions
    if (actionType === "delete_all") {
      await prisma.feedback.deleteMany({});
    }

    // Return fresh data list
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: "desc" },
    });
    return json({ success: true, feedback, passcode });
  } catch (err) {
    return json({ success: false, error: "Database error: " + (err.message || String(err)), passcode });
  }
};

export default function FeedbackAdmin() {
  const actionData = useActionData();
  const navigate = useNavigate();
  const nav = useNavigation();
  const submit = useSubmit();
  const [passcode, setPasscode] = useState("");
  const [activePasscode, setActivePasscode] = useState("");
  const [selectedTab, setSelectedTab] = useState(0);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);

  const isSubmitting = nav.state === "submitting";
  const isAuthenticated = actionData?.success === true || !!activePasscode;
  const feedbackList = actionData?.feedback || [];

  const currentPass = actionData?.passcode || activePasscode || passcode;

  const complaints = feedbackList.filter(f => f.type === "bug");
  const featureRequests = feedbackList.filter(f => f.type === "feature");
  const generalFeedback = feedbackList.filter(f => f.type === "feedback");

  let displayedList = feedbackList;
  if (selectedTab === 1) displayedList = complaints;
  if (selectedTab === 2) displayedList = featureRequests;
  if (selectedTab === 3) displayedList = generalFeedback;

  const tabs = [
    {
      id: "all-submissions",
      content: `All Submissions (${feedbackList.length})`,
      panelID: "all-submissions-content",
    },
    {
      id: "complaints",
      content: `🐛 Complaints & Bugs (${complaints.length})`,
      panelID: "complaints-content",
    },
    {
      id: "features",
      content: `💡 Feature Requests (${featureRequests.length})`,
      panelID: "features-content",
    },
    {
      id: "general",
      content: `⭐ General Feedback (${generalFeedback.length})`,
      panelID: "general-content",
    },
  ];

  const handleUnlock = () => {
    if (!passcode) return;
    setActivePasscode(passcode);
    submit({ passcode, _action: "unlock" }, { method: "post" });
  };

  const handleRefresh = () => {
    submit({ passcode: currentPass, _action: "unlock" }, { method: "post" });
  };

  const handleDeleteSingle = (id) => {
    if (confirm("Are you sure you want to delete this submission?")) {
      submit(
        {
          passcode: currentPass,
          _action: "delete",
          id: id.toString(),
        },
        { method: "post" }
      );
    }
  };

  const handleDeleteAll = () => {
    setShowDeleteAllModal(false);
    submit(
      {
        passcode: currentPass,
        _action: "delete_all",
      },
      { method: "post" }
    );
  };

  return (
    <Page
      title="👨‍💻 Developer Support & Complaints Hub"
      subtitle="Private master portal for ZXTYSIX LLP engineering"
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
                  Enter your master developer passcode to view merchant feedback, bug reports, and customer complaints.
                </Text>

                {actionData?.error && (
                  <Banner tone="critical">
                    <p>{actionData.error}</p>
                  </Banner>
                )}

                <InlineStack gap="300" blockAlign="end">
                  <div style={{ flex: 1 }}>
                    <TextField
                      label="Developer Master Passcode"
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
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <div>
                    <Text variant="headingMd" as="h2">Merchant Submissions & Complaints</Text>
                    <Text variant="bodySm" tone="subdued">Live SQLite Database Stream</Text>
                  </div>
                  <InlineStack gap="200">
                    {feedbackList.length > 0 && (
                      <Button
                        tone="critical"
                        variant="secondary"
                        onClick={() => setShowDeleteAllModal(true)}
                        loading={isSubmitting}
                      >
                        🗑️ Delete All Submissions
                      </Button>
                    )}
                    <Button onClick={handleRefresh} loading={isSubmitting}>🔄 Refresh Data</Button>
                  </InlineStack>
                </InlineStack>
              </Box>

              <Tabs tabs={tabs} selected={selectedTab} onSelect={setSelectedTab} fitted />
              <Divider />

              {displayedList.length === 0 ? (
                <Box padding="400">
                  <EmptyState
                    heading="No entries in this category"
                    image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
                  >
                    <p>New customer complaints and feedback from the Settings form will appear here automatically.</p>
                  </EmptyState>
                </Box>
              ) : (
                <IndexTable
                  resourceName={{ singular: "submission", plural: "submissions" }}
                  itemCount={displayedList.length}
                  headings={[
                    { title: "Store & Contact Email" },
                    { title: "Type / Category" },
                    { title: "Rating" },
                    { title: "Message / Complaint Details" },
                    { title: "Date Submitted" },
                    { title: "Actions" },
                  ]}
                  selectable={false}
                >
                  {displayedList.map(({ id, shop, email, rating, type, message, createdAt }, index) => {
                    let typeBadge;
                    if (type === "bug") {
                      typeBadge = <Badge tone="critical">🐛 Bug / Complaint</Badge>;
                    } else if (type === "feature") {
                      typeBadge = <Badge tone="info">💡 Feature Request</Badge>;
                    } else {
                      typeBadge = <Badge tone="success">⭐ General Feedback</Badge>;
                    }

                    return (
                      <IndexTable.Row id={id.toString()} key={id} position={index}>
                        <IndexTable.Cell>
                          <Text variant="bodyMd" fontWeight="bold">{shop}</Text>
                          {email ? <Text variant="bodySm" tone="subdued">{email}</Text> : <Text variant="bodySm" tone="subdued">No email provided</Text>}
                        </IndexTable.Cell>
                        <IndexTable.Cell>{typeBadge}</IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text fontWeight="semibold">{rating} / 5 ⭐</Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <div style={{ whiteSpace: "normal", minWidth: "220px", maxWidth: "380px", lineHeight: "1.4" }}>
                            {message}
                          </div>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Text variant="bodySm" tone="subdued">
                            {new Date(createdAt).toLocaleString()}
                          </Text>
                        </IndexTable.Cell>
                        <IndexTable.Cell>
                          <Button
                            variant="plain"
                            tone="critical"
                            onClick={() => handleDeleteSingle(id)}
                          >
                            🗑️ Delete
                          </Button>
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

      {/* Delete All Confirmation Modal */}
      <Modal
        open={showDeleteAllModal}
        onClose={() => setShowDeleteAllModal(false)}
        title="Delete All Submissions?"
        primaryAction={{
          content: "Yes, Delete All",
          destructive: true,
          onAction: handleDeleteAll,
          loading: isSubmitting,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => setShowDeleteAllModal(false),
          },
        ]}
      >
        <Modal.Section>
          <Text as="p">
            Are you sure you want to permanently delete all merchant feedback and customer complaints from the database? This action cannot be undone.
          </Text>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

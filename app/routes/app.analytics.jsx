import { json } from "@remix-run/node";
import { useLoaderData, useSubmit, useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  Text,
  Select,
  Grid,
  DatePicker,
  Modal,
  Button,
  Box,
  InlineStack,
  Badge,
  Banner,
  Divider,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { useState, useCallback } from "react";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const filter = url.searchParams.get("filter") || "this_month";
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");

  const now = new Date();
  let startDate, endDate;

  if (filter === "custom" && startParam && endParam) {
    startDate = new Date(startParam + "T00:00:00");
    endDate = new Date(endParam + "T23:59:59");
  } else if (filter === "today") {
    startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  } else if (filter === "yesterday") {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    startDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    endDate = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
  } else if (filter === "last_7") {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 6);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else if (filter === "last_30") {
    startDate = new Date(now);
    startDate.setDate(now.getDate() - 29);
    startDate.setHours(0, 0, 0, 0);
    endDate = new Date(now);
    endDate.setHours(23, 59, 59, 999);
  } else if (filter === "last_month") {
    startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
  } else {
    // default: this_month
    startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  }

  try {
    const views = await prisma.viewCount.findMany({
      where: { shop: session.shop, date: { gte: startDate, lte: endDate } },
      orderBy: { date: "asc" },
    });
    const totalViews = views.reduce((acc, curr) => acc + curr.count, 0);
    const totalClicks = views.reduce((acc, curr) => acc + curr.clicks, 0);
    const totalPurchases = views.reduce((acc, curr) => acc + curr.purchases, 0);

    // Also calculate monthly total for free tier limit (500 views)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    const monthViews = await prisma.viewCount.findMany({
      where: { shop: session.shop, date: { gte: monthStart, lte: monthEnd } },
    });
    const thisMonthTotal = monthViews.reduce((acc, curr) => acc + curr.count, 0);

    return json({
      totalViews,
      totalClicks,
      totalPurchases,
      thisMonthTotal,
      filter,
      startParam: startParam || null,
      endParam: endParam || null,
    });
  } catch (e) {
    return json({
      totalViews: 0,
      totalClicks: 0,
      totalPurchases: 0,
      thisMonthTotal: 0,
      filter,
      startParam: null,
      endParam: null,
    });
  }
};

export default function Analytics() {
  const { totalViews, totalClicks, totalPurchases, thisMonthTotal, filter, startParam, endParam } = useLoaderData();

  const submit = useSubmit();
  const navigate = useNavigate();

  const today = new Date();
  const initStart = startParam ? new Date(startParam) : new Date(today.getFullYear(), today.getMonth(), 1);
  const initEnd = endParam ? new Date(endParam) : today;

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentFilter, setCurrentFilter] = useState(filter);
  const [{ month, year }, setDate] = useState({
    month: initStart.getMonth(),
    year: initStart.getFullYear(),
  });
  const [selectedDates, setSelectedDates] = useState({
    start: initStart,
    end: initEnd,
  });

  const handleSelectChange = (val) => {
    setCurrentFilter(val);
    if (val === "custom") {
      setIsModalOpen(true);
    } else {
      submit({ filter: val }, { method: "get" });
    }
  };

  const handleApplyCustomDate = () => {
    setIsModalOpen(false);
    const formatYMD = (d) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    };

    submit(
      {
        filter: "custom",
        start: formatYMD(selectedDates.start),
        end: formatYMD(selectedDates.end || selectedDates.start),
      },
      { method: "get" }
    );
  };

  const formatDisplayRange = () => {
    if (filter === "custom" && startParam && endParam) {
      const f = (s) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${f(startParam)} – ${f(endParam)}`;
    }
    return null;
  };

  return (
    <Page title="Analytics">
      <Layout>
        <Layout.Section>
          <BlockStack gap="500">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="center" wrap>
                  <BlockStack gap="100">
                    <Text variant="headingMd" as="h2">View Statistics</Text>
                    {filter === "custom" && formatDisplayRange() && (
                      <Badge tone="info">Custom: {formatDisplayRange()}</Badge>
                    )}
                  </BlockStack>

                  <InlineStack gap="200" blockAlign="center">
                    <Select
                      label="Date range"
                      labelHidden
                      options={[
                        { label: "Today", value: "today" },
                        { label: "Yesterday", value: "yesterday" },
                        { label: "Last 7 days", value: "last_7" },
                        { label: "Last 30 days", value: "last_30" },
                        { label: "This month", value: "this_month" },
                        { label: "Last month", value: "last_month" },
                        { label: "Custom range…", value: "custom" },
                      ]}
                      value={currentFilter}
                      onChange={handleSelectChange}
                    />

                    {filter === "custom" && (
                      <Button onClick={() => setIsModalOpen(true)}>
                        Change Dates
                      </Button>
                    )}
                  </InlineStack>
                </InlineStack>
              </BlockStack>
            </Card>

            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3" tone="subdued">
                      Total Views
                    </Text>
                    <Text variant="heading3xl" as="p" fontWeight="bold">
                      {totalViews.toLocaleString()}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      {filter === "custom" && formatDisplayRange()
                        ? `Between ${formatDisplayRange()}`
                        : "In selected period"}
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3" tone="subdued">
                      Pill Clicks
                    </Text>
                    <Text variant="heading3xl" as="p" fontWeight="bold">
                      {totalClicks.toLocaleString()}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Liquid Glass Tag clicks
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3" tone="subdued">
                      Purchases
                    </Text>
                    <Text variant="heading3xl" as="p" fontWeight="bold">
                      {totalPurchases.toLocaleString()}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      From video clicks
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 3, md: 3, lg: 3, xl: 3 }}>
                <Card>
                  <BlockStack gap="200">
                    <Text variant="headingMd" as="h3" tone="subdued">
                      Free Tier Remaining
                    </Text>
                    <Text variant="heading3xl" as="p" fontWeight="bold">
                      {Math.max(0, 500 - thisMonthTotal).toLocaleString()}
                    </Text>
                    <Text variant="bodySm" as="p" tone="subdued">
                      Views left this month
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>
            </Grid>
          </BlockStack>
        </Layout.Section>
      </Layout>
      <div style={{ height: "40px" }} />

      {/* Custom Date Range Modal */}
      <Modal
        open={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setCurrentFilter(filter);
        }}
        title="Select Custom Date Range"
        primaryAction={{
          content: "Apply Range",
          onAction: handleApplyCustomDate,
        }}
        secondaryActions={[
          {
            content: "Cancel",
            onAction: () => {
              setIsModalOpen(false);
              setCurrentFilter(filter);
            },
          },
        ]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              Pick a start date and end date to filter video impressions:
            </Text>

            <Box
              padding="300"
              background="bg-surface-secondary"
              borderRadius="200"
            >
              <InlineStack align="center">
                <DatePicker
                  month={month}
                  year={year}
                  selected={selectedDates}
                  onChange={(range) => setSelectedDates(range)}
                  onMonthChange={(m, y) => setDate({ month: m, year: y })}
                  allowRange
                  disableDatesAfter={today}
                />
              </InlineStack>
            </Box>

            <InlineStack align="space-between" blockAlign="center">
              <Text variant="bodySm" tone="subdued">
                Selected: {selectedDates.start ? selectedDates.start.toLocaleDateString() : ""}
                {selectedDates.end ? ` → ${selectedDates.end.toLocaleDateString()}` : ""}
              </Text>
            </InlineStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

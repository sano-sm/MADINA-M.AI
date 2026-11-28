import React from "react";
import { useI18n } from "@/context/I18nContext";
import { PageHeader } from "@/components/kit";

// Reserved page: intentionally no data requests or financial widgets.
export default function Dashboard() {
  const { t } = useI18n();
  return <div><PageHeader title={t("dashboard")} /></div>;
}

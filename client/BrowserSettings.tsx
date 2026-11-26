import { useSettings, useTranslation } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { browserSettings } from "../shared/browserSettings.js";
import { messages } from "./messages.js";

export function BrowserSettings() {
  const settings = useSettings(browserSettings);
  const { t } = useTranslation(messages);
  const saveError = settings.saveError ? t("settings.saveFailed") : undefined;

  const loading = settings.status === "loading";
  if (!loading && settings.status !== "ready") {
    const invalid = settings.status === "invalid";
    return (
      <SettingsAction
        label={t("browser.openWith")}
        actionLabel={t(invalid ? "settings.reset" : "settings.retry")}
        error={saveError ?? t(invalid ? "settings.invalid" : "settings.loadFailed")}
        disabled={settings.saving}
        onPress={invalid ? settings.reset : settings.reload}
      />
    );
  }

  return (
    <SettingsSelect
      label={t("browser.openWith")}
      value={loading ? "" : settings.values.browser}
      options={loading ? [{ value: "", label: t("settings.loading") }] : [
        { value: "paseo", label: t("browser.paseo") },
        { value: "system", label: t("browser.system") },
      ]}
      disabled={loading || settings.saving}
      error={saveError}
      onValueChange={(browser) => {
        if (settings.status === "ready" && browser !== "") void settings.save({ browser }, settings.revision);
      }}
    />
  );
}

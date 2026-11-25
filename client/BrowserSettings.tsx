import { useSettings, useTranslation, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsAction, SettingsCard, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { Text } from "react-native";
import { browserSettings } from "../shared/browserSettings.js";
import { messages } from "./messages.js";

export function BrowserSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(browserSettings);
  const { t } = useTranslation(messages);
  const textStyle = { color: theme.colors.foreground };

  if (settings.status === "loading") return <Text style={textStyle}>{t("browser.loading")}</Text>;
  if (settings.status !== "ready") {
    return (
      <SettingsCard>
        <Text accessibilityRole="alert" style={textStyle}>{settings.saveError ?? settings.error}</Text>
        {settings.status === "invalid" ? (
          <SettingsAction label={t("browser.openWith")} actionLabel={t("browser.reset")} disabled={settings.saving} onPress={settings.reset} />
        ) : (
          <SettingsAction label={t("browser.openWith")} actionLabel={t("browser.reload")} onPress={settings.reload} />
        )}
      </SettingsCard>
    );
  }

  return (
    <SettingsCard>
      <SettingsSelect
        label={t("browser.openWith")}
        value={settings.values.browser}
        options={[
          { value: "paseo", label: t("browser.paseo") },
          { value: "system", label: t("browser.system") },
        ]}
        disabled={settings.saving}
        error={settings.saveError}
        onValueChange={(browser) => { void settings.save({ browser }, settings.revision); }}
      />
    </SettingsCard>
  );
}
